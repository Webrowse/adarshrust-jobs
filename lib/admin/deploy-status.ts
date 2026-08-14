/**
 * Has a published snapshot commit actually reached the live site?
 *
 * Publishing writes a commit; the site only changes when the deploy workflow
 * that commit triggered has finished. Nothing local can observe that: the admin
 * runs on your machine and production is a pile of files on Cloudflare Pages,
 * so the only source of truth is the workflow run itself.
 *
 * This replaces a Railway-era heuristic that compared RAILWAY_GIT_COMMIT_SHA
 * against the publish, falling back to the serving process's uptime. Both
 * inputs became meaningless the moment production stopped being a long-lived
 * server that the admin ran inside.
 *
 * Deliberately returns null rather than guessing whenever the answer cannot be
 * established - no token, no repo configured, API error, or no run found yet.
 * A wrong "live" is worse than an absent one, because it is the signal you
 * check before assuming a Refresh landed.
 */
const DEPLOY_WORKFLOW = "deploy.yml"

export async function isCommitDeployed(sha: string | null | undefined): Promise<boolean | null> {
  if (!sha) return null

  const token = process.env.GITHUB_TOKEN
  const repo = process.env.PUBLISH_REPO // "owner/name"
  if (!token || !repo?.includes("/")) return null

  try {
    const res = await fetch(
      `https://api.github.com/repos/${repo}/actions/workflows/${DEPLOY_WORKFLOW}/runs` +
        `?head_sha=${encodeURIComponent(sha)}&per_page=1`,
      {
        headers: {
          authorization: `Bearer ${token}`,
          accept: "application/vnd.github+json",
          "x-github-api-version": "2022-11-28",
        },
        cache: "no-store",
      },
    )
    if (!res.ok) return null

    const body = (await res.json()) as {
      workflow_runs?: { status?: string; conclusion?: string }[]
    }
    const run = body.workflow_runs?.[0]
    // No run yet means the push has not been picked up - "not deployed", not "unknown".
    if (!run) return false
    return run.status === "completed" && run.conclusion === "success"
  } catch {
    return null
  }
}
