import { listEntries, type ListEntryRow } from "@/lib/admin/lists"
import { ListsManager } from "@/components/admin/lists-manager"
import { isAdmin } from "@/lib/admin/require-admin"

export default async function ListsPage() {
  if (!(await isAdmin())) return null
  let entries: ListEntryRow[] = []
  let dbDown = false
  try {
    entries = await listEntries()
  } catch {
    dbDown = true
  }

  return (
    <>
      <div className="adm-page-header">
        <span className="adm-page-title">Lists</span>
        <span className="adm-page-meta">{entries.length} entries</span>
      </div>
      <div className="adm-content">
        {dbDown ? (
          <div className="adm-db-warn" style={{ marginLeft: 0 }}>DB unreachable — lists unavailable</div>
        ) : (
          <ListsManager entries={entries} />
        )}
      </div>
    </>
  )
}
