import { getAdminJobs, getAdminCompanies } from "@/lib/admin/job-intel"
import { JobIntelligence } from "@/components/admin/job-intelligence"
import { isAdmin } from "@/lib/admin/require-admin"

export default async function JobsPage() {
  if (!(await isAdmin())) return null
  let jobs = null
  let companies = null
  try {
    ;[jobs, companies] = await Promise.all([getAdminJobs(), getAdminCompanies()])
  } catch {
    // DB unreachable - render the empty state below.
  }

  return (
    <>
      <div className="adm-page-header">
        <span className="adm-page-title">Job intelligence</span>
        <span className="adm-page-meta">
          {jobs ? `${jobs.length} live jobs · ${companies?.length ?? 0} companies — corrections stored as overrides` : "database unreachable"}
        </span>
      </div>
      {jobs === null || companies === null ? (
        <div className="adm-empty"><span className="adm-empty__label">Database unreachable — job intelligence needs Postgres.</span></div>
      ) : (
        <div className="adm-content">
          <JobIntelligence jobs={jobs} companies={companies} />
        </div>
      )}
    </>
  )
}
