import { listOverrides, type OverrideRow } from "@/lib/admin/overrides"
import { EcoOverridesManager } from "@/components/admin/eco-overrides-manager"
import { LifecycleEdgesManager } from "@/components/admin/lifecycle-edges-manager"
import { isAdmin } from "@/lib/admin/require-admin"

export default async function OverridesPage() {
  if (!(await isAdmin())) return null
  let ecoTags: OverrideRow[] = []
  let lifecycleEdges: OverrideRow[] = []
  let dbDown = false
  try {
    ;[ecoTags, lifecycleEdges] = await Promise.all([
      listOverrides("eco-tags"),
      listOverrides("lifecycle-edges"),
    ])
  } catch {
    dbDown = true
  }

  return (
    <>
      <div className="adm-page-header">
        <span className="adm-page-title">Overrides</span>
        <span className="adm-page-meta">Manual configuration, not editorial content</span>
      </div>
      <div className="adm-content">
        {dbDown ? (
          <div className="adm-db-warn" style={{ marginLeft: 0 }}>DB unreachable — overrides unavailable</div>
        ) : (
          <>
            <EcoOverridesManager rows={ecoTags} />
            <div style={{ height: 32 }} />
            <LifecycleEdgesManager rows={lifecycleEdges} />
          </>
        )}
      </div>
    </>
  )
}
