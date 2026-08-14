import { prisma } from "@/lib/prisma"
import type { ContentType } from "./types"

/**
 * Pipeline run records. Each Refresh inserts one row that also serves as the
 * run lock: a fresh `running` row blocks concurrent runs, and a stale heartbeat
 * lets a new run take over a crashed one. Acquisition is serialised with a
 * transaction-scoped Postgres advisory lock so two simultaneous presses cannot
 * both start.
 */

export type RunStatus = "running" | "done" | "failed"

/** Outcome of publishing the content snapshot to Git after a dirty run. */
export type PublishReport = {
  state: "skipped_no_changes" | "committed" | "failed"
  commitSha?: string
  error?: string
}

export type PipelineReport = {
  added: Partial<Record<ContentType, number>>
  removed: Partial<Record<ContentType, number>>
  scanned: number
  blocked: number
  verified: number
  reviewed: number
  published: number
  skipped: number
  errors: string[]
  notes: string[]
  perSource?: Record<string, number>
  publish?: PublishReport
}

export type RunRow = {
  id: string
  status: RunStatus
  startedAt: Date
  finishedAt: Date | null
  heartbeat: Date
  dirty: boolean
  report: PipelineReport | null
}

// A run whose heartbeat is older than this is treated as crashed.
const STALE_MS = 10 * 60 * 1000
// Fixed key for the acquisition advisory lock (arbitrary, app-unique).
const LOCK_KEY = 48_202_411

function toRow(r: {
  id: string; status: string; startedAt: Date; finishedAt: Date | null;
  heartbeat: Date; dirty: boolean; report: unknown;
}): RunRow {
  return {
    id: r.id,
    status: r.status as RunStatus,
    startedAt: r.startedAt,
    finishedAt: r.finishedAt,
    heartbeat: r.heartbeat,
    dirty: r.dirty,
    report: (r.report as PipelineReport | null) ?? null,
  }
}

export type AcquireResult =
  | { acquired: true; run: RunRow }
  | { acquired: false; active: RunRow }

/**
 * Try to start a run. Returns the active run instead if one is already in
 * progress. Stale runs (dead heartbeat) are marked failed and taken over.
 *
 * This is normally the first query a scheduled job makes, and Neon scales its
 * compute to zero, so the connection is usually cold. That cold start ate the
 * whole of Prisma's 2s transaction-acquire window and failed the backfill cron
 * outright ("Unable to start a transaction in the given time", 2026-08-15).
 * Two guards: wake the connection outside the transaction, and give the
 * acquire a window that a slow wake cannot exhaust.
 */
export async function acquireRun(): Promise<AcquireResult> {
  await prisma.$queryRaw`SELECT 1`
  return prisma.$transaction(async (tx) => {
    // Serialise concurrent acquisitions; auto-released at transaction end.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LOCK_KEY})`

    const staleCutoff = new Date(Date.now() - STALE_MS)
    const running = await tx.pipelineRun.findMany({ where: { status: "running" } })

    for (const r of running) {
      if (r.heartbeat < staleCutoff) {
        await tx.pipelineRun.update({ where: { id: r.id }, data: { status: "failed", finishedAt: new Date() } })
      }
    }

    const fresh = running.find((r) => r.heartbeat >= staleCutoff)
    if (fresh) return { acquired: false, active: toRow(fresh) } as AcquireResult

    const run = await tx.pipelineRun.create({ data: { status: "running" } })
    return { acquired: true, run: toRow(run) } as AcquireResult
  }, { maxWait: 20_000, timeout: 30_000 })
}

/** Keep the lock alive; call between phases. */
export async function heartbeat(runId: string): Promise<void> {
  await prisma.pipelineRun.update({ where: { id: runId }, data: { heartbeat: new Date() } })
}

export async function finishRun(
  runId: string,
  opts: { status: "done" | "failed"; dirty: boolean; report: PipelineReport },
): Promise<void> {
  await prisma.pipelineRun.update({
    where: { id: runId },
    data: {
      status: opts.status,
      dirty: opts.dirty,
      finishedAt: new Date(),
      report: opts.report as never,
    },
  })
}

/** The current in-progress run, if one is genuinely alive (fresh heartbeat). */
export async function getActiveRun(): Promise<RunRow | null> {
  const staleCutoff = new Date(Date.now() - STALE_MS)
  const r = await prisma.pipelineRun.findFirst({
    where: { status: "running", heartbeat: { gte: staleCutoff } },
    orderBy: { startedAt: "desc" },
  })
  return r ? toRow(r) : null
}

export async function getLatestRun(): Promise<RunRow | null> {
  const r = await prisma.pipelineRun.findFirst({ orderBy: { startedAt: "desc" } })
  return r ? toRow(r) : null
}

export async function listRuns(limit = 20): Promise<RunRow[]> {
  const rows = await prisma.pipelineRun.findMany({ orderBy: { startedAt: "desc" }, take: limit })
  return rows.map(toRow)
}

/** Manual recovery: force any running rows to failed (e.g. a wedged lock). */
export async function forceUnlock(): Promise<number> {
  const res = await prisma.pipelineRun.updateMany({
    where: { status: "running" },
    data: { status: "failed", finishedAt: new Date() },
  })
  return res.count
}
