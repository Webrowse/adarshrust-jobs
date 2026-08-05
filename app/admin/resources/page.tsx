import Link from "next/link"
import { getResources, RESOURCE_CATEGORIES, type ResourceCategory } from "@/lib/admin/resources"
import { ResourcesManager } from "@/components/admin/resources-manager"
import { isAdmin } from "@/lib/admin/require-admin"

const CATEGORY_IDS = Object.keys(RESOURCE_CATEGORIES) as ResourceCategory[]

interface PageProps {
  searchParams: Promise<{ cat?: string }>
}

export default async function ResourcesPage({ searchParams }: PageProps) {
  if (!(await isAdmin())) return null
  const { cat } = await searchParams
  const active: ResourceCategory = CATEGORY_IDS.includes(cat as ResourceCategory) ? (cat as ResourceCategory) : "stay-updated"
  const meta = RESOURCE_CATEGORIES[active]

  let rows = null
  try {
    rows = await getResources(active)
  } catch {
    // DB unreachable - render the empty state below.
  }

  return (
    <>
      <div className="adm-tabs">
        {CATEGORY_IDS.map((id) => (
          <Link key={id} href={`/admin/resources?cat=${id}`} className={`adm-tab${active === id ? " adm-tab--active" : ""}`}>
            {RESOURCE_CATEGORIES[id].label}
          </Link>
        ))}
      </div>

      <div className="adm-page-header">
        <span className="adm-page-title">Resource library — {meta.label}</span>
        <span className="adm-page-meta">{meta.description}</span>
      </div>

      <div className="adm-content">
        {rows === null ? (
          <div className="adm-empty"><span className="adm-empty__label">Database unreachable — the library needs Postgres.</span></div>
        ) : (
          <ResourcesManager category={active} rows={rows} types={meta.types} kinds={meta.kinds} />
        )}
      </div>
    </>
  )
}
