/**
 * CLI: refresh GitHub metadata for one batch of already-published repos, then exit.
 *
 * Unlike run-one-backfill-batch.ts, this runs Tier 1 *through* the orchestrator
 * and reports the real dirty flag. That matters: the enrichment backfill hardcodes
 * dirty:false, so everything it writes sits in Postgres invisible to visitors
 * until somebody presses Republish by hand. Refreshed star counts are worthless
 * under that rule, so this job publishes itself when it changed something - and
 * stays silent (no commit, no deploy) when GitHub reported nothing new.
 *
 * Batch size is capped well under GitHub's 5,000 req/hour so one run cannot
 * exhaust the budget; the batch also stops early if the remaining budget runs low.
 * A full pass over the corpus therefore spans slightly more than one run, which is
 * deliberate: publishing commits a multi-megabyte snapshot to Git permanently, so
 * a weekly commit is affordable where a daily one is not.
 *
 * If another run holds the lock, exits 0 (not an error) - the same convention as
 * run-one-backfill-batch.ts, since an overlapping tick is expected, not a failure.
 *
 * Run: tsx scripts/run-github-refresh-batch.ts
 * Env: GITHUB_REFRESH_BATCH_SIZE (default 4500), GITHUB_TOKEN (required for the 5,000/h limit)
 */
import { config } from "dotenv"

// Load env before the Prisma client is constructed (dynamic import in main()).
config({ path: ".env.local" })
config()

const DEFAULT_BATCH_SIZE = 4500

function batchSize(): number {
  const raw = Number(process.env.GITHUB_REFRESH_BATCH_SIZE)
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_BATCH_SIZE
}

function emptyReport() {
  return {
    added: {}, removed: {}, scanned: 0, blocked: 0, verified: 0, reviewed: 0,
    published: 0, skipped: 0, errors: [] as string[], notes: [] as string[], perSource: {},
  }
}

async function main() {
  const { acquireRun, finishRun, heartbeat } = await import("@/lib/admin/pipeline-runs")
  const { githubRefreshBatch } = await import("@/lib/pipeline/refresh-github")
  const { runPipelineOrchestrator } = await import("@/lib/pipeline/orchestrator")

  if (!process.env.GITHUB_TOKEN) {
    console.warn("! GITHUB_TOKEN is not set - GitHub allows only 60 req/hour unauthenticated")
  }

  const acq = await acquireRun()
  if (!acq.acquired) {
    console.log(`Skipped: run ${acq.active.id} already active (status=${acq.active.status})`)
    process.exit(0)
  }

  const runId = acq.run.id
  const size = batchSize()
  try {
    const report = emptyReport()
    let summary = ""

    // Tier 1 is the refresh itself; the orchestrator runs Tier 2 (corpus
    // intelligence) and Tier 3 (exports -> Git publish) only when it returns dirty.
    const { dirty } = await runPipelineOrchestrator(report, async (r) => {
      const res = await githubRefreshBatch(size, () => heartbeat(runId))
      summary =
        `GitHub refresh: ${res.processed} checked, ${res.changed} changed, ` +
        `${res.unchanged} unchanged, ${res.notFound} missing upstream, ` +
        `${res.failed} failed, ${res.remaining} still stale` +
        (res.rateLimited ? " (stopped early: GitHub rate limit)" : "")
      r.notes.push(summary)
      r.scanned = res.processed
      if (res.failed > 0) r.errors.push(`github-refresh: ${res.failed} repos failed to fetch`)
      return { dirty: res.changed > 0 }
    })

    await finishRun(runId, { status: "done", dirty, report })
    console.log(`✓ ${summary}`)
    console.log(dirty ? "  changed -> corpus recomputed and published" : "  no changes -> nothing published")
    process.exit(0)
  } catch (err) {
    const msg = (err as Error)?.message ?? String(err)
    await finishRun(runId, { status: "failed", dirty: false, report: { ...emptyReport(), errors: [msg] } })
    console.error(`✗ GitHub refresh failed: ${msg}`)
    process.exit(1)
  }
}

main().catch((err) => {
  console.error(`✗ run-github-refresh-batch: uncaught error: ${(err as Error)?.message ?? err}`)
  process.exit(1)
})
