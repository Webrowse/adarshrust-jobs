import { listAudit, listAuditActions } from "@/lib/admin/audit"
import { isAdmin } from "@/lib/admin/require-admin"

interface PageProps {
  searchParams: Promise<{ action?: string; target?: string }>
}

function fmt(d: Date): string {
  return d.toISOString().slice(0, 16).replace("T", " ") + "Z"
}

function summarizeChanges(changes: unknown): string {
  if (!changes || typeof changes !== "object") return ""
  try {
    const s = JSON.stringify(changes)
    return s.length > 220 ? s.slice(0, 220) + "…" : s
  } catch {
    return ""
  }
}

export default async function AuditPage({ searchParams }: PageProps) {
  if (!(await isAdmin())) return null
  const { action = "", target = "" } = await searchParams
  let entries = null
  let actions: string[] = []
  try {
    ;[entries, actions] = await Promise.all([
      listAudit({ action: action || undefined, target: target || undefined }),
      listAuditActions(),
    ])
  } catch {
    // DB unreachable - render the empty state below.
  }

  return (
    <>
      <div className="adm-page-header">
        <span className="adm-page-title">Audit trail</span>
        <span className="adm-page-meta">every manual change: what, when, why</span>
      </div>

      <div className="adm-content">
        <form method="get" className="adm-queue-toolbar">
          <select className="adm-select" name="action" defaultValue={action}>
            <option value="">action: any</option>
            {actions.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <input className="adm-search" name="target" placeholder="Filter by target (repo, URL, person)…" defaultValue={target} />
          <button type="submit" className="adm-btn adm-btn--ghost">Filter</button>
          <span className="adm-queue-toolbar__count">{entries?.length ?? 0} entries</span>
        </form>

        {entries === null ? (
          <div className="adm-empty"><span className="adm-empty__label">Database unreachable — the audit trail needs Postgres.</span></div>
        ) : entries.length === 0 ? (
          <div className="adm-empty">
            <span className="adm-empty__label">No audit entries yet.</span>
            <span>Curation actions will appear here as they happen. If the table is missing, run `npm run db:sync-schema`.</span>
          </div>
        ) : (
          <div className="adm-audit-list">
            {entries.map((e) => (
              <div key={e.id} className="adm-audit">
                <div className="adm-audit__head">
                  <span className="adm-audit__action">{e.action}</span>
                  <span className="adm-audit__target">{e.target}</span>
                  <span className="adm-audit__time">{fmt(e.createdAt)} · {e.actor}</span>
                </div>
                {e.reason && <div className="adm-audit__reason">“{e.reason}”</div>}
                {summarizeChanges(e.changes) && <div className="adm-audit__changes">{summarizeChanges(e.changes)}</div>}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  )
}
