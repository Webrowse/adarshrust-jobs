"use client"

import { useEffect, useState, useTransition } from "react"
import {
  runRefresh, republishSnapshot, unlockPipeline, getPipelineStatus,
  type RefreshResult,
} from "@/lib/pipeline/actions"
import type { RunRow, PublishReport } from "@/lib/admin/pipeline-runs"
import type { PublishMetadata } from "@/lib/admin/publish-metadata"

function fmt(d: Date | string | null): string {
  if (!d) return "-"
  const date = typeof d === "string" ? new Date(d) : d
  if (isNaN(date.getTime())) return "-"
  // Deterministic UTC format so server and client render identically (no
  // locale/timezone hydration mismatch).
  return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`
}

function PublishBanner({ publish }: { publish?: PublishReport }) {
  if (!publish) return null
  if (publish.state === "committed") {
    return (
      <div className="adm-log" style={{ color: "var(--e-ok, #2a7d4f)" }}>
        Published: Git commit {publish.commitSha?.slice(0, 7)} created. GitHub Actions will build and deploy it.
      </div>
    )
  }
  if (publish.state === "skipped_no_changes") {
    return <div className="adm-log">No content changes - nothing to publish.</div>
  }
  return (
    <div className="adm-db-warn" style={{ marginLeft: 0 }}>
      Publish failed: {publish.error}. Postgres is up to date; press Republish to retry.
    </div>
  )
}

function ReportSummary({ run }: { run: RunRow }) {
  const r = run.report
  if (!r) return <div className="adm-log">No report.</div>
  const added = Object.entries(r.added).filter(([, n]) => n > 0)
  const removed = Object.entries(r.removed).filter(([, n]) => n > 0)
  const lines = [
    `Status:    ${run.status}${run.dirty ? " · published content changed" : ""}`,
    `Finished:  ${fmt(run.finishedAt)}`,
    "",
    `Scanned:   ${r.scanned}`,
    `Blocked:   ${r.blocked}`,
    `Verified:  ${r.verified}`,
    `Reviewed:  ${r.reviewed}`,
    `Published: ${r.published}`,
    `Skipped:   ${r.skipped}`,
    added.length ? `Added:     ${added.map(([t, n]) => `${t}:${n}`).join("  ")}` : "",
    removed.length ? `Removed:   ${removed.map(([t, n]) => `${t}:${n}`).join("  ")}` : "",
  ]
  if (r.errors.length) {
    lines.push("", `Errors (${r.errors.length}):`)
    r.errors.slice(0, 8).forEach((e) => lines.push(`  x ${e}`))
  }
  // Notes were being written and never shown: the backfill CLI reports its batch
  // result here, and an unroutable source reports itself here too.
  if (r.notes.length) {
    lines.push("", `Notes (${r.notes.length}):`)
    r.notes.slice(0, 8).forEach((n) => lines.push(`  - ${n}`))
  }
  return <div className="adm-log">{lines.join("\n")}</div>
}

function secs(total: number): string {
  const s = Math.max(0, Math.round(total))
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`
}

/**
 * Live state for an in-flight run. The server action for a full Refresh can take
 * many minutes, and its HTTP response may never arrive (an edge proxy can time
 * the request out long before the pipeline finishes) - so the panel polls the run
 * row instead of trusting the action to report back. Heartbeat age is the useful
 * signal: the pipeline bumps it between phases, so a growing age means wedged,
 * not slow.
 */
function RunningStatus({ run, now }: { run: RunRow; now: number }) {
  const elapsed = (now - new Date(run.startedAt).getTime()) / 1000
  const beatAge = (now - new Date(run.heartbeat).getTime()) / 1000
  const lines = [
    `Status:    running`,
    `Started:   ${fmt(run.startedAt)}`,
    `Elapsed:   ${secs(elapsed)}`,
    `Heartbeat: ${secs(beatAge)} ago${beatAge > 120 ? "   <- no progress for a while" : ""}`,
  ]
  return <div className="adm-log">{lines.join("\n")}</div>
}

interface RefreshPanelProps {
  initialActive: RunRow | null
  initialLatest: RunRow | null
  initialPublish: PublishMetadata | null
}

export function RefreshPanel({ initialActive, initialLatest, initialPublish }: RefreshPanelProps) {
  const [latest, setLatest] = useState<RunRow | null>(initialLatest)
  const [active, setActive] = useState<RunRow | null>(initialActive)
  const [blocked, setBlocked] = useState(false)
  const [pending, start] = useTransition()

  // Both Refresh and Republish return the same shape, so one handler drives both.
  function run(action: () => Promise<RefreshResult>) {
    setBlocked(false)
    start(async () => {
      const res = await action()
      if (res.started) { setLatest(res.run); setActive(null) }
      else { setActive(res.active); setBlocked(true) }
    })
  }

  function unlock() {
    start(async () => {
      await unlockPipeline()
      setActive(null)
      setBlocked(false)
    })
  }

  const busy = pending || !!active

  // 0 until the client takes over, so the server and first client render agree.
  const [now, setNow] = useState(0)

  // Tick the clock so Elapsed/Heartbeat advance without waiting on a poll.
  useEffect(() => {
    if (!busy) return
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [busy])

  // Poll the run row while anything is in flight. This is what makes the panel
  // honest: the pipeline writes its heartbeat to Postgres, so progress shows even
  // if the action's own response is slow or never lands. Once the run clears, pull
  // the finished row so the report appears without a manual reload.
  useEffect(() => {
    if (!busy) return
    let cancelled = false
    const poll = async () => {
      try {
        const s = await getPipelineStatus()
        if (cancelled) return
        setActive(s.active)
        if (!s.active && s.latest) setLatest(s.latest)
      } catch {
        // Transient failure (deploy restart, lost connection): keep polling.
      }
    }
    const id = setInterval(poll, 2000)
    return () => { cancelled = true; clearInterval(id) }
  }, [busy])

  return (
    <div className="adm-content" style={{ maxWidth: 640 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
        <button className="adm-btn adm-btn--primary" onClick={() => run(runRefresh)} disabled={busy}>
          {busy ? "Running..." : "Refresh"}
        </button>
        <button
          className="adm-btn adm-btn--ghost"
          onClick={() => run(republishSnapshot)}
          disabled={busy}
          title="Re-export the current Postgres snapshot and publish it to Git"
        >
          Republish
        </button>
        {(active || blocked) && (
          <button className="adm-btn adm-btn--ghost" onClick={unlock} disabled={pending}>
            Force unlock
          </button>
        )}
      </div>

      <div className="adm-page-meta" style={{ marginBottom: 10 }}>
        Live snapshot:{" "}
        {initialPublish?.lastCommitSha
          ? `${initialPublish.lastCommitSha.slice(0, 7)} - published ${fmt(initialPublish.lastPublishedAt)}`
          : "never published"}
      </div>

      {blocked && active && (
        <div className="adm-db-warn" style={{ marginLeft: 0 }}>
          A run is already in progress (started {fmt(active.startedAt)}). Try again shortly.
        </div>
      )}

      {active && (
        <>
          <div className="adm-page-meta" style={{ marginBottom: 6, marginTop: 10 }}>In progress</div>
          {now ? <RunningStatus run={active} now={now} /> : <div className="adm-log">Status:    running</div>}
        </>
      )}

      {!active && latest?.report?.publish && <PublishBanner publish={latest.report.publish} />}

      {!active && latest && (
        <>
          <div className="adm-page-meta" style={{ marginBottom: 6, marginTop: 10 }}>Last run</div>
          <ReportSummary run={latest} />
        </>
      )}

      {!active && !latest && (
        <div className="adm-log">No runs yet. Press Refresh to run the pipeline.</div>
      )}
    </div>
  )
}
