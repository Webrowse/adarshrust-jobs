import { getEnrichmentProgress } from "@/lib/pipeline/maintenance-actions"
import { getActiveRun } from "@/lib/admin/pipeline-runs"
import { BackfillPanel } from "@/components/admin/backfill-panel"
import type { BackfillProgress } from "@/lib/pipeline/backfill"
import { isAdmin } from "@/lib/admin/require-admin"

export default async function MaintenancePage() {
  if (!(await isAdmin())) return null
  let progress: BackfillProgress | null = null
  let active = null
  try {
    ;[progress, active] = await Promise.all([getEnrichmentProgress(), getActiveRun()])
  } catch {
    // DB unreachable - panel still renders and the batch action will surface the error.
  }

  return (
    <>
      <div className="adm-page-header">
        <span className="adm-page-title">Maintenance</span>
        <span className="adm-page-meta">Corpus-wide enrichment backfill</span>
      </div>
      <BackfillPanel initialProgress={progress} initialActive={active} />
    </>
  )
}
