import { listSources, type SourceRow } from "@/lib/admin/sources"
import { KIND_TO_COLLECTOR } from "@/lib/pipeline/dispatch"
import { SourcesManager } from "@/components/admin/sources-manager"
import { isAdmin } from "@/lib/admin/require-admin"

export default async function SourcesPage() {
  if (!(await isAdmin())) return null
  let sources: SourceRow[] = []
  let dbDown = false
  try {
    sources = await listSources()
  } catch {
    dbDown = true
  }

  return (
    <>
      <div className="adm-page-header">
        <span className="adm-page-title">Sources</span>
        <span className="adm-page-meta">{sources.length} sources · {sources.filter((s) => s.enabled).length} enabled</span>
      </div>
      <div className="adm-content">
        {dbDown ? (
          <div className="adm-db-warn" style={{ marginLeft: 0 }}>DB unreachable — sources unavailable</div>
        ) : (
          <SourcesManager sources={sources} routableKinds={Object.keys(KIND_TO_COLLECTOR)} />
        )}
      </div>
    </>
  )
}
