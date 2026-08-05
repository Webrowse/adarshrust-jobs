import { readContent } from "@/lib/admin/storage"
import { PeopleManager, type PersonRow } from "@/components/admin/people-manager"
import { isAdmin } from "@/lib/admin/require-admin"

export default async function PeoplePage() {
  if (!(await isAdmin())) return null
  let people: PersonRow[] | null = null
  try {
    const items = await readContent("authors")
    people = items.map((p) => ({
      name: String(p.name ?? ""),
      handle: String(p.handle ?? ""),
      href: String(p.href ?? ""),
      writing: String(p.writing ?? ""),
      description: String(p.description ?? ""),
      tags: Array.isArray(p.tags) ? (p.tags as string[]) : [],
    }))
  } catch {
    // DB unreachable - render the empty state below.
  }

  return (
    <>
      <div className="adm-page-header">
        <span className="adm-page-title">People directory</span>
        <span className="adm-page-meta">
          {people ? `${people.length} people — feeds Explore → People` : "database unreachable"}
        </span>
      </div>
      <div className="adm-content">
        {people === null ? (
          <div className="adm-empty"><span className="adm-empty__label">Database unreachable — the directory needs Postgres.</span></div>
        ) : (
          <PeopleManager people={people} />
        )}
      </div>
    </>
  )
}
