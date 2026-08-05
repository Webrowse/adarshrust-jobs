import { prisma } from "@/lib/prisma"
import { GH_HEADERS } from "./scan/github"

/**
 * Tier 1 GitHub refresh: re-read objective GitHub metadata for repos already in
 * the corpus, so stars, forks, issue counts and activity tier stop being frozen
 * at whatever they were on the day the repo was discovered.
 *
 * Nothing else does this. The scanners skip already-known hrefs (ScanContext's
 * isKnown) and publishBatch is insert-only, so a published repo's row is never
 * revisited; the enrichment backfill only re-reads Cargo manifests, and its
 * pushedAt gate can never fire precisely because pushedAt is one of the fields
 * that never gets updated. Without this job the corpus ages permanently.
 *
 * Selection is watermark-based (data.githubCheckedAt, a date string like the
 * existing checkedAt/depsCheckedAt) and resumable: each run takes the staleest
 * `batchSize` repos, so consecutive runs walk the corpus without repeating work.
 * The watermark advances even when GitHub reports no change, otherwise the same
 * repos would be reselected forever and the walk would never progress.
 *
 * Memory: the candidate query returns ids only, and rows are loaded in small
 * chunks - deliberately unlike runBackfillBatch, which pulls all ~5,400 rows
 * with their full JSON into memory (twice) to pick 25. Railway bills memory by
 * the minute, so a batch job holding the whole corpus is a direct cost.
 */

/** Refresh a repo once its metadata is older than this. */
export const GITHUB_REFRESH_MAX_AGE_DAYS = 7

/** Rows loaded and updated per chunk - keeps peak heap flat regardless of batchSize. */
const CHUNK = 100

/** Stop early with this much of the hourly REST budget left, so a run never wedges on 403s. */
const RATE_LIMIT_FLOOR = 50

/**
 * Pause between repo fetches. The hourly quota is not the binding constraint here
 * (a full batch stays under it); this is about GitHub's secondary abuse limits,
 * which trigger on request *rate* rather than volume. Matches the 150ms the
 * pre-Postgres one-off used successfully against this same endpoint.
 */
const REQUEST_SPACING_MS = 150

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

type Data = Record<string, unknown>

/**
 * Activity tier from last push. Thresholds match the values already present in
 * the corpus (see scripts/backfill-oss-github.mjs, the pre-Postgres one-off this
 * job replaces) so a refresh never reclassifies a repo that has not moved.
 */
export function computeActivityTier(pushedAt: string | null | undefined): "active" | "maintenance" | "dormant" {
  if (!pushedAt) return "dormant"
  const days = (Date.now() - new Date(pushedAt).getTime()) / 86_400_000
  if (days <= 30) return "active"
  if (days <= 90) return "maintenance"
  return "dormant"
}

/** Whether a row's GitHub metadata is old enough to re-read. Pure; see scripts/check-github-refresh.ts. */
export function needsGithubRefresh(data: Data, now = Date.now(), maxAgeDays = GITHUB_REFRESH_MAX_AGE_DAYS): boolean {
  const at = data.githubCheckedAt
  if (typeof at !== "string" || at === "") return true
  const t = Date.parse(at)
  if (Number.isNaN(t)) return true
  return now - t >= maxAgeDays * 86_400_000
}

/** github.com/<owner>/<repo> -> "<owner>/<repo>". Null when the href is not a repo URL. */
export function repoPathFromHref(href: string): string | null {
  const m = href.match(/github\.com\/([^/#?]+)\/([^/#?]+)/)
  return m ? `${m[1]}/${m[2]}` : null
}

/** The published fields this job owns. Only a change to one of these makes a run dirty. */
const REFRESHED_FIELDS = [
  "stars", "forks", "openIssuesCount", "language", "license", "pushedAt", "activityTier",
] as const

export type GithubRefreshResult = {
  processed: number
  changed: number
  unchanged: number
  failed: number
  notFound: number
  rateLimited: boolean
  remaining: number
}

type GhRepo = {
  stargazers_count?: number
  forks_count?: number
  open_issues_count?: number
  language?: string | null
  license?: { spdx_id?: string | null } | null
  pushed_at?: string | null
}

/**
 * One repo fetch. Returns null for 404 (deleted or renamed upstream - not an
 * error worth failing the batch over) and reports the remaining hourly budget so
 * the caller can stop before GitHub starts refusing.
 */
async function fetchRepo(
  fullName: string,
): Promise<{ repo: GhRepo | null; notFound: boolean; remaining: number | null }> {
  const res = await fetch(`https://api.github.com/repos/${fullName}`, {
    headers: GH_HEADERS,
    signal: AbortSignal.timeout(20_000),
    next: { revalidate: 0 },
  })
  const rawRemaining = res.headers.get("x-ratelimit-remaining")
  const remaining = rawRemaining === null ? null : Number(rawRemaining)
  if (res.status === 404) return { repo: null, notFound: true, remaining }
  if (!res.ok) throw new Error(`GitHub API ${res.status} for ${fullName}`)
  return { repo: (await res.json()) as GhRepo, notFound: false, remaining }
}

/** Merge fresh GitHub data over a row, preserving existing values when GitHub omits a field. */
export function applyGithubData(data: Data, gh: GhRepo, today: string): Data {
  const pushedAt = gh.pushed_at ?? (typeof data.pushedAt === "string" ? data.pushedAt : null)
  return {
    ...data,
    stars: gh.stargazers_count ?? data.stars ?? null,
    forks: gh.forks_count ?? data.forks ?? 0,
    openIssuesCount: gh.open_issues_count ?? data.openIssuesCount ?? 0,
    language: gh.language ?? data.language ?? null,
    license: gh.license?.spdx_id ?? data.license ?? null,
    pushedAt,
    activityTier: computeActivityTier(pushedAt),
    githubCheckedAt: today,
  }
}

/** True when any field this job owns actually differs. The watermark alone does not count. */
export function hasRefreshChange(before: Data, after: Data): boolean {
  return REFRESHED_FIELDS.some((f) => before[f] !== after[f])
}

/**
 * Re-read GitHub metadata for up to `batchSize` of the staleest repos.
 *
 * `changed > 0` is what makes the caller's run dirty, which is what lets Tier 2
 * recompute and Tier 3 publish. A run where every repo came back identical
 * writes watermarks but produces no commit, because the published fields are
 * byte-identical and the publisher's no-op gate catches it.
 */
export async function githubRefreshBatch(
  batchSize: number,
  onRepo?: () => Promise<void>,
): Promise<GithubRefreshResult> {
  const cutoff = new Date(Date.now() - GITHUB_REFRESH_MAX_AGE_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 10)
  const today = new Date().toISOString().slice(0, 10)

  // ids only: the whole point is to not drag ~5,400 JSON blobs through memory.
  const candidates = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM content_items
    WHERE type = 'oss'
      AND (data->>'githubCheckedAt' IS NULL OR (data->>'githubCheckedAt') < ${cutoff})
    ORDER BY (data->>'githubCheckedAt') ASC NULLS FIRST, id ASC
    LIMIT ${batchSize}
  `

  const result: GithubRefreshResult = {
    processed: 0, changed: 0, unchanged: 0, failed: 0, notFound: 0,
    rateLimited: false, remaining: 0,
  }

  for (let i = 0; i < candidates.length; i += CHUNK) {
    const ids = candidates.slice(i, i + CHUNK).map((c) => c.id)
    const rows = await prisma.contentItem.findMany({ where: { id: { in: ids } } })

    for (const row of rows) {
      await onRepo?.() // keep the run lock's heartbeat alive across a long batch
      const data = row.data as Data
      const path = repoPathFromHref(String(data.href ?? row.href ?? ""))
      if (!path) {
        result.failed++
        continue
      }

      try {
        const { repo, notFound, remaining } = await fetchRepo(path)
        result.processed++

        if (notFound || !repo) {
          // Stamp the watermark so a deleted repo is not retried every run; the
          // curation queues are where a missing repo gets judged, not here.
          result.notFound++
          await prisma.contentItem.update({
            where: { id: row.id },
            data: { data: { ...data, githubCheckedAt: today } as never },
          })
        } else {
          const next = applyGithubData(data, repo, today)
          if (hasRefreshChange(data, next)) result.changed++
          else result.unchanged++
          await prisma.contentItem.update({ where: { id: row.id }, data: { data: next as never } })
        }

        if (remaining !== null && remaining <= RATE_LIMIT_FLOOR) {
          result.rateLimited = true
          break
        }
        await sleep(REQUEST_SPACING_MS)
      } catch {
        // Transient upstream failure: leave the watermark alone so the next run retries.
        result.failed++
        await sleep(REQUEST_SPACING_MS)
      }
    }
    if (result.rateLimited) break
  }

  const [{ n }] = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT count(*) AS n FROM content_items
    WHERE type = 'oss'
      AND (data->>'githubCheckedAt' IS NULL OR (data->>'githubCheckedAt') < ${cutoff})
  `
  result.remaining = Number(n)
  return result
}
