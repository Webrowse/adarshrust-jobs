import { createHash } from "crypto"
import { Octokit } from "@octokit/rest"
import { type SnapshotFile, snapshotSha256 } from "./snapshot"

/**
 * Publish a content snapshot to Git as one atomic commit via the GitHub Git
 * Data API (no clone, no working tree). PostgreSQL is the source of truth; this
 * writes the derived snapshot so the deploy workflow rebuilds and ships it.
 *
 * Large files go up as blobs, never inline. Sending file contents inside the
 * createTree call is what GitHub means by "your input was too large to process":
 * the full oss corpus file alone is ~40 MB, which JSON-escapes to ~45 MB inside
 * that request body, and on 2026-08-04 the endpoint began answering 422. Uploading
 * each changed file with createBlob first and referencing the returned SHAs is
 * the "build the tree incrementally" path GitHub's own error text recommends,
 * and it keeps each request proportional to one file instead of the whole
 * snapshot.
 *
 * The no-op decision still compares against what is ACTUALLY in the repo right
 * now, not a locally stored hash - so a failed or uncertain previous push can
 * never cause a wrong skip or a spurious empty commit. It just does it without
 * transferring anything: a file's Git object id is a pure function of its bytes,
 * so hashing locally and comparing against the blob SHAs already listed in the
 * base tree is an exact content comparison. Reading Git to decide whether to
 * write does not make it a source of truth: the published bytes always come
 * from Postgres.
 *
 * Result is one of three explicit states so the caller can report precisely.
 */

export type PublishResult =
  | { state: "skipped_no_changes" }
  | { state: "committed"; commitSha: string; contentSha256: string }
  | { state: "failed"; error: string }

type Config = { token: string; owner: string; repo: string; branch: string }

const COMMIT_MESSAGE = "content: publish snapshot from Postgres"

/** Read config from env. Returns an error string if anything required is missing. */
function readConfig(): Config | { error: string } {
  const token = process.env.GITHUB_PUBLISH_TOKEN
  const slug = process.env.PUBLISH_REPO // "owner/name"
  const branch = process.env.PUBLISH_BRANCH || "main"
  if (!token) return { error: "GITHUB_PUBLISH_TOKEN is not set" }
  if (!slug || !slug.includes("/")) return { error: "PUBLISH_REPO must be set as owner/name" }
  const [owner, repo] = slug.split("/")
  return { token, owner, repo, branch }
}

/**
 * Git's object id for a file: sha1("blob <byte-length>\0" + bytes). Identical to
 * `git hash-object`, so the result can be compared directly against the blob
 * SHAs GitHub returns in a tree listing - which is how the no-op gate decides
 * "unchanged" without downloading a single byte of content.
 */
function gitBlobSha(content: string): string {
  const bytes = Buffer.from(content, "utf-8")
  return createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex")
}

/**
 * Map of path -> blob SHA for everything currently committed on the base tree.
 * A path missing from the map (new file, or a tree large enough that GitHub
 * truncated the listing) simply reads as "changed", which is the safe direction:
 * the file gets re-uploaded and the tree-identity check in commitSnapshot still
 * prevents an empty commit.
 */
async function readTreeBlobShas(
  octokit: Octokit,
  cfg: Config,
  baseTreeSha: string,
): Promise<Map<string, string>> {
  const tree = await octokit.git.getTree({
    owner: cfg.owner,
    repo: cfg.repo,
    tree_sha: baseTreeSha,
    recursive: "true",
  })
  const shaByPath = new Map<string, string>()
  for (const entry of tree.data.tree) {
    if (entry.path && entry.sha && entry.type === "blob") shaByPath.set(entry.path, entry.sha)
  }
  return shaByPath
}

/**
 * Upload the changed files as blobs, build a tree on top of the base, and move
 * the branch ref. Returns the new commit SHA, or null when the resulting tree is
 * byte-identical to the base (nothing to commit).
 *
 * Blobs upload one at a time on purpose: the snapshot is tens of megabytes and
 * this runs inside the web server, so holding one base64 body in memory at a
 * time keeps the publish off the memory bill.
 */
async function commitSnapshot(
  octokit: Octokit,
  cfg: Config,
  changed: SnapshotFile[],
  headSha: string,
  baseTreeSha: string,
): Promise<string | null> {
  const entries: { path: string; mode: "100644"; type: "blob"; sha: string }[] = []
  for (const file of changed) {
    const blob = await octokit.git.createBlob({
      owner: cfg.owner,
      repo: cfg.repo,
      content: Buffer.from(file.content, "utf-8").toString("base64"),
      encoding: "base64",
    })
    entries.push({ path: file.path, mode: "100644", type: "blob", sha: blob.data.sha })
  }

  const tree = await octokit.git.createTree({
    owner: cfg.owner,
    repo: cfg.repo,
    base_tree: baseTreeSha,
    tree: entries,
  })
  // Backstop for a truncated tree listing: if every "changed" file turned out to
  // match what was already committed, the new tree is the base tree and there is
  // nothing to publish. Creating a tree does not move the branch, so bailing here
  // leaves Git untouched.
  if (tree.data.sha === baseTreeSha) return null

  const commit = await octokit.git.createCommit({
    owner: cfg.owner,
    repo: cfg.repo,
    message: COMMIT_MESSAGE,
    tree: tree.data.sha,
    parents: [headSha],
  })
  await octokit.git.updateRef({
    owner: cfg.owner,
    repo: cfg.repo,
    ref: `heads/${cfg.branch}`,
    sha: commit.data.sha,
  })
  return commit.data.sha
}

/**
 * Publish the given snapshot. Never throws - network/API failures come back as
 * { state: "failed" } so the caller keeps the (correct) Postgres state and
 * surfaces the error for a manual Republish.
 */
export async function publishSnapshot(files: SnapshotFile[]): Promise<PublishResult> {
  const contentSha256 = snapshotSha256(files)
  const cfg = readConfig()
  if ("error" in cfg) return { state: "failed", error: cfg.error }

  const octokit = new Octokit({ auth: cfg.token })

  try {
    // One retry covers a benign non-fast-forward (branch tip moved under us).
    for (let attempt = 0; attempt < 2; attempt++) {
      const ref = await octokit.git.getRef({ owner: cfg.owner, repo: cfg.repo, ref: `heads/${cfg.branch}` })
      const headSha = ref.data.object.sha
      const headCommit = await octokit.git.getCommit({ owner: cfg.owner, repo: cfg.repo, commit_sha: headSha })
      const baseTreeSha = headCommit.data.tree.sha

      const shaByPath = await readTreeBlobShas(octokit, cfg, baseTreeSha)
      const changed = files.filter((file) => shaByPath.get(file.path) !== gitBlobSha(file.content))
      if (changed.length === 0) return { state: "skipped_no_changes" }

      try {
        const commitSha = await commitSnapshot(octokit, cfg, changed, headSha, baseTreeSha)
        if (!commitSha) return { state: "skipped_no_changes" }
        return { state: "committed", commitSha, contentSha256 }
      } catch (err) {
        // Retry once from a fresh head; otherwise fall through to failure.
        if (attempt === 1) throw err
      }
    }
    return { state: "failed", error: "publish exhausted retries" }
  } catch (err) {
    return { state: "failed", error: (err as Error)?.message ?? String(err) }
  }
}
