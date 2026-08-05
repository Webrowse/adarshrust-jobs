import Link from "next/link"
import { getAdminRepos, buildQueues, QUEUE_META, QUEUE_IDS, type QueueId } from "@/lib/admin/curation"
import { QueueList } from "@/components/admin/curation-queue"
import { isAdmin } from "@/lib/admin/require-admin"

interface PageProps {
  searchParams: Promise<{ tab?: string }>
}

export default async function QueuePage({ searchParams }: PageProps) {
  if (!(await isAdmin())) return null
  const { tab } = await searchParams
  const activeTab: QueueId = QUEUE_IDS.includes(tab as QueueId) ? (tab as QueueId) : "needs-review"

  let queues = null
  try {
    queues = buildQueues(await getAdminRepos())
  } catch {
    // DB unreachable - render the empty state below.
  }

  return (
    <>
      <div className="adm-tabs">
        {QUEUE_IDS.map((id) => (
          <Link key={id} href={`/admin/queue?tab=${id}`} className={`adm-tab${activeTab === id ? " adm-tab--active" : ""}`}>
            {QUEUE_META[id].label}
            {queues && queues[id].length > 0 && <span className="adm-badge adm-badge--dim">{queues[id].length}</span>}
          </Link>
        ))}
      </div>

      <div className="adm-page-header">
        <span className="adm-page-title">Curation queue — {QUEUE_META[activeTab].label}</span>
        <span className="adm-page-meta">{QUEUE_META[activeTab].description}</span>
      </div>

      <div className="adm-content">
        {queues === null ? (
          <div className="adm-empty"><span className="adm-empty__label">Database unreachable — queues need Postgres.</span></div>
        ) : queues[activeTab].length === 0 ? (
          <div className="adm-empty"><span className="adm-empty__label">Queue clear — nothing waiting for review.</span></div>
        ) : (
          <QueueList queue={activeTab} items={queues[activeTab]} />
        )}
      </div>
    </>
  )
}
