import { getAdminRepos } from "@/lib/admin/curation"
import { RepoControl } from "@/components/admin/repo-control"
import { isAdmin } from "@/lib/admin/require-admin"

interface PageProps {
  searchParams: Promise<{ activity?: string; state?: string; flag?: string; q?: string }>
}

export default async function ReposPage({ searchParams }: PageProps) {
  if (!(await isAdmin())) return null
  const initial = await searchParams
  let repos = null
  try {
    repos = await getAdminRepos()
  } catch {
    // DB unreachable - render the empty state below.
  }

  return (
    <>
      <div className="adm-page-header">
        <span className="adm-page-title">Repositories</span>
        <span className="adm-page-meta">
          {repos ? `${repos.length.toLocaleString()} in corpus — overrides never touch raw data` : "database unreachable"}
        </span>
      </div>
      {repos === null ? (
        <div className="adm-empty"><span className="adm-empty__label">Database unreachable — repository control needs Postgres.</span></div>
      ) : (
        <RepoControl repos={repos} initialFilters={initial} />
      )}
    </>
  )
}
