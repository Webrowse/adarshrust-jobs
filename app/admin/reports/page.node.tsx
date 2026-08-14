import { listRuns, type RunRow } from "@/lib/admin/pipeline-runs"
import { isAdmin } from "@/lib/admin/require-admin"

function fmt(d: Date | null): string {
  if (!d) return "—"
  return `${new Date(d).toISOString().slice(0, 16).replace("T", " ")} UTC`
}

function duration(run: RunRow): string {
  if (!run.finishedAt) return "running"
  const ms = new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime()
  return `${Math.round(ms / 1000)}s`
}

function RunCard({ run }: { run: RunRow }) {
  const r = run.report
  const added = r ? Object.entries(r.added).filter(([, n]) => n > 0) : []
  const removed = r ? Object.entries(r.removed).filter(([, n]) => n > 0) : []
  const statusColor =
    run.status === "done" ? "oklch(0.72 0.17 145)" :
    run.status === "failed" ? "oklch(0.66 0.18 22)" :
    "oklch(0.78 0.12 42)"

  return (
    <div className="adm-run">
      <div className="adm-run__head">
        <span className="adm-run__status" style={{ color: statusColor }}>{run.status}</span>
        <span className="adm-run__time">{fmt(run.startedAt)} · {duration(run)}</span>
        {run.dirty && <span className="adm-run__dirty">published changed</span>}
      </div>
      {r && (
        <div className="adm-run__stats">
          <span>scanned {r.scanned}</span>
          <span>blocked {r.blocked}</span>
          <span>verified {r.verified}</span>
          <span>reviewed {r.reviewed}</span>
          <span>published {r.published}</span>
          <span>skipped {r.skipped}</span>
        </div>
      )}
      {(added.length > 0 || removed.length > 0) && (
        <div className="adm-run__delta">
          {added.length > 0 && <span className="adm-run__added">+ {added.map(([t, n]) => `${t}:${n}`).join("  ")}</span>}
          {removed.length > 0 && <span className="adm-run__removed">− {removed.map(([t, n]) => `${t}:${n}`).join("  ")}</span>}
        </div>
      )}
      {r?.errors && r.errors.length > 0 && (
        <div className="adm-run__errors">
          {r.errors.slice(0, 5).map((e, i) => <div key={i}>✗ {e}</div>)}
        </div>
      )}
    </div>
  )
}

export default async function ReportsPage() {
  if (!(await isAdmin())) return null
  let runs: RunRow[] = []
  let dbDown = false
  try {
    runs = await listRuns(30)
  } catch {
    dbDown = true
  }

  return (
    <>
      <div className="adm-page-header">
        <span className="adm-page-title">Reports</span>
        <span className="adm-page-meta">{runs.length} recent {runs.length === 1 ? "run" : "runs"}</span>
      </div>
      <div className="adm-content">
        {dbDown ? (
          <div className="adm-db-warn" style={{ marginLeft: 0 }}>DB unreachable — reports unavailable</div>
        ) : runs.length === 0 ? (
          <div className="adm-empty"><span className="adm-empty__label">No pipeline runs yet</span></div>
        ) : (
          <div className="adm-run-list">
            {runs.map((run) => <RunCard key={run.id} run={run} />)}
          </div>
        )}
      </div>
    </>
  )
}
