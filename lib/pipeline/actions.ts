"use server"

import { revalidatePath } from "next/cache"
import { requireAdmin } from "@/lib/admin/require-admin"
import {
  acquireRun, finishRun, getActiveRun, getLatestRun, forceUnlock,
  type RunRow, type PipelineReport,
} from "@/lib/admin/pipeline-runs"
import { runPipeline } from "./run"
import { dueScanJobs } from "./dispatch"
import { publishCurrentSnapshot, publishNote } from "./publish"
import { runPipelineOrchestrator } from "./orchestrator"

export type RefreshResult =
  | { started: true; run: RunRow }
  | { started: false; active: RunRow }

function emptyReport(): PipelineReport {
  return {
    added: {}, removed: {}, scanned: 0, blocked: 0, verified: 0,
    reviewed: 0, published: 0, skipped: 0, errors: [], notes: [], perSource: {},
  }
}

function failedReport(err: unknown): PipelineReport {
  return { ...emptyReport(), errors: [String(err)] }
}

/**
 * Refresh supplies Tier 1 (discover, enrich, persist to PostgreSQL) and hands
 * it to the shared pipeline orchestrator, which runs Tier 2 (Corpus
 * Intelligence) and Tier 3 (Exports) when Tier 1 changed the corpus (dirty).
 * Refresh does not contain the tier sequence itself - see orchestrator.ts. A
 * Tier 3 failure never fails the run - PostgreSQL is already correct and the
 * failure is surfaced for a manual Republish. Returns the active run if one
 * is already in progress.
 */
export async function runRefresh(): Promise<RefreshResult> {
  await requireAdmin()

  const acq = await acquireRun()
  if (!acq.acquired) return { started: false, active: acq.active }

  const runId = acq.run.id
  try {
    const { jobs, unroutable } = await dueScanJobs()
    const report = emptyReport()
    // A due source with no collector would otherwise be dropped in silence and
    // stay due forever while the admin shows it as enabled. Report it every run
    // as a note rather than an error: the run itself did not fail.
    for (const s of unroutable) {
      report.notes.push(
        `Source "${s.label}" (kind: ${s.kind}) has no collector and was skipped. ` +
        `It stays due until a collector is registered in KIND_TO_COLLECTOR or the source is disabled.`,
      )
    }
    const { dirty } = await runPipelineOrchestrator(report, (r) => runPipeline(runId, jobs, r))
    await finishRun(runId, { status: "done", dirty, report })
  } catch (e) {
    await finishRun(runId, { status: "failed", dirty: false, report: failedReport(e) })
    throw e
  }

  revalidatePath("/admin")
  const latest = await getLatestRun()
  return { started: true, run: latest! }
}

/**
 * Re-export the current Postgres snapshot and publish it to Git, without
 * scanning or writing Postgres. Recovery path for a failed or uncertain push.
 * Takes the same run lock as Refresh so it can never read a half-written
 * snapshot mid-run, and always regenerates from live Postgres (no replay).
 */
export async function republishSnapshot(): Promise<RefreshResult> {
  await requireAdmin()

  const acq = await acquireRun()
  if (!acq.acquired) return { started: false, active: acq.active }

  const runId = acq.run.id
  try {
    const report = emptyReport()
    report.publish = await publishCurrentSnapshot()
    report.notes.push(publishNote(report.publish))
    await finishRun(runId, { status: "done", dirty: false, report })
  } catch (e) {
    await finishRun(runId, { status: "failed", dirty: false, report: failedReport(e) })
    throw e
  }

  revalidatePath("/admin")
  const latest = await getLatestRun()
  return { started: true, run: latest! }
}

export async function getPipelineStatus(): Promise<{ active: RunRow | null; latest: RunRow | null }> {
  await requireAdmin()
  const [active, latest] = await Promise.all([getActiveRun(), getLatestRun()])
  return { active, latest }
}

/** Manual recovery for a wedged lock. */
export async function unlockPipeline(): Promise<number> {
  await requireAdmin()
  const n = await forceUnlock()
  revalidatePath("/admin")
  return n
}
