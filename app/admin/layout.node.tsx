import Link from "next/link"
import { headers } from "next/headers"
import { getPublishedCounts } from "@/lib/admin/storage"
import type { ContentType } from "@/lib/admin/types"
import { CONTENT_SCHEMA, CONTENT_TYPES } from "@/lib/admin/content-schema"
import { getSession, signOut, googleEnabled } from "@/lib/auth"
import { AdminLogin } from "@/components/admin/admin-login"
import { EditorialLayout } from "@/components/editorial/editorial-layout"
import "./admin.css"

const ADMIN_EMAIL = process.env.ADMIN_EMAIL
const ZERO_COUNTS = Object.fromEntries(CONTENT_TYPES.map((t) => [t, 0])) as Record<ContentType, number>

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession()
  const email = session?.user?.email

  // Unauthenticated: show inline login. The admin is reachable from any device
  // at /admin without a separate login route.
  if (!email) {
    return <AdminLogin googleEnabled={googleEnabled} />
  }

  // Authenticated but not the admin account: deny with a sign-out escape hatch.
  if (email !== ADMIN_EMAIL) {
    return (
      <EditorialLayout>
        <section className="e-signin">
          <div className="e-signin__card">
            <div className="e-signin__eyebrow">Admin</div>
            <h1 className="e-signin__title">Not authorized</h1>
            <p className="e-signin__hint">
              {email} is signed in but does not have access to this admin.
            </p>
            <div className="e-signin__providers">
              <form
                action={async () => {
                  "use server"
                  await signOut({ redirectTo: "/admin" })
                }}
              >
                <button type="submit" className="e-signin__btn">Sign out</button>
              </form>
            </div>
            <Link href="/" className="e-signin__home">← Back to homepage</Link>
          </div>
        </section>
      </EditorialLayout>
    )
  }

  const host = (await headers()).get("host") ?? ""
  const isLocal = host.startsWith("localhost") || host.startsWith("127.0.0.1") || host.startsWith("::1")

  let publishedCounts = ZERO_COUNTS
  let dbDown = false
  try {
    publishedCounts = await getPublishedCounts()
  } catch {
    dbDown = true
  }

  const contentTypes: ContentType[] = CONTENT_TYPES

  return (
    <div className="adm">
      <aside className="adm-sidebar">
        <div className="adm-sidebar__brand">
          <span className="adm-sidebar__mark" />
          <span>osspath</span>
          <span className="adm-sidebar__env">{isLocal ? "localhost" : "live"}</span>
        </div>

        {dbDown && (
          <div className="adm-db-warn">DB unreachable — counts unavailable</div>
        )}

        <nav className="adm-nav">
          <Link href="/admin" className="adm-nav__item adm-nav__item--queue">
            <span>Control Center</span>
          </Link>

          <div className="adm-nav__section">Curation</div>
          <Link href="/admin/repos" className="adm-nav__item adm-nav__item--sub">
            <span>Repositories</span>
          </Link>
          <Link href="/admin/queue" className="adm-nav__item adm-nav__item--sub">
            <span>Review queue</span>
          </Link>
          <Link href="/admin/jobs" className="adm-nav__item adm-nav__item--sub">
            <span>Job intelligence</span>
          </Link>
          <Link href="/admin/people" className="adm-nav__item adm-nav__item--sub">
            <span>People</span>
          </Link>
          <Link href="/admin/resources" className="adm-nav__item adm-nav__item--sub">
            <span>Resources</span>
          </Link>
          <Link href="/admin/audit" className="adm-nav__item adm-nav__item--sub">
            <span>Audit trail</span>
          </Link>

          <div className="adm-nav__section">Pipeline</div>
          <Link href="/admin/reports" className="adm-nav__item adm-nav__item--sub">
            <span>Reports</span>
          </Link>
          <Link href="/admin/sources" className="adm-nav__item adm-nav__item--sub">
            <span>Sources</span>
          </Link>
          <Link href="/admin/lists" className="adm-nav__item adm-nav__item--sub">
            <span>Lists</span>
          </Link>

          <div className="adm-nav__section">Maintenance</div>
          <Link href="/admin/maintenance" className="adm-nav__item adm-nav__item--sub">
            <span>Enrichment backfill</span>
          </Link>

          <div className="adm-nav__section">Published</div>
          {contentTypes.map((t) => (
            <Link key={t} href={`/admin/published?type=${t}`} className="adm-nav__item adm-nav__item--sub">
              <span>{CONTENT_SCHEMA[t].label}</span>
              {publishedCounts[t] > 0 && <span className="adm-badge adm-badge--dim">{publishedCounts[t]}</span>}
            </Link>
          ))}

          <div className="adm-nav__section">Overrides</div>
          <Link href="/admin/overrides" className="adm-nav__item adm-nav__item--sub">
            <span>Configuration</span>
          </Link>
        </nav>

        <div className="adm-sidebar__footer">
          <div className="adm-sidebar__user">
            <span className="adm-sidebar__user-dot" />
            <span className="adm-sidebar__user-email">{email}</span>
          </div>
          <form action={async () => {
            "use server"
            await signOut({ redirectTo: "/admin" })
          }}>
            <button type="submit" className="adm-sidebar__signout">Sign out</button>
          </form>
          <Link href="/" className="adm-sidebar__home" target="_blank" rel="noopener">
            ↗ Public site
          </Link>
        </div>
      </aside>

      <main className="adm-main">
        {children}
      </main>
    </div>
  )
}
