import { auth } from "@/lib/auth"

/** Throws unless the current session is the configured admin account. */
export async function requireAdmin(): Promise<void> {
  const session = await auth()
  const adminEmail = process.env.ADMIN_EMAIL
  if (!adminEmail || session?.user?.email !== adminEmail) {
    throw new Error("Unauthorized")
  }
}

/**
 * Non-throwing admin check for page components. Every page under app/admin must
 * call this and bail before doing any work:
 *
 *     if (!(await isAdmin())) return null
 *
 * The layout is NOT a gate. app/admin/layout.tsx returns <AdminLogin/> without
 * rendering {children}, but in the App Router a layout receives children that
 * have already been rendered - discarding them hides the output visually while
 * the page has still executed its queries, and its result still ships inside the
 * RSC payload. That leaked the Control Center's corpus and curation stats to
 * unauthenticated visitors, and ran the dashboard's DB queries on every hit.
 * Returning null here leaves the layout's sign-in card as the visible page, so
 * the UX is unchanged.
 */
export async function isAdmin(): Promise<boolean> {
  const session = await auth()
  const adminEmail = process.env.ADMIN_EMAIL
  return Boolean(adminEmail && session?.user?.email === adminEmail)
}
