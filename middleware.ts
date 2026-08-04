import { NextResponse, type NextRequest } from "next/server"

/**
 * Cost control: pure SEO/backlink-audit crawlers are refused before rendering.
 *
 * These are not search engines and send no referral traffic, but they sweep the
 * whole corpus on a loop. On 2026-08-04 SERankingBacklinksBot alone was 1,102 of
 * 1,567 requests (70%), and /oss is a 6.04 MB response — that sweep drove RSS
 * from 0.19 GB to 0.82 GB in an hour. Railway bills memory by the minute and
 * memory is ~91% of the bill, so refusing these is the cheapest lever there is.
 *
 * app/robots.ts asks the same crawlers to stay away; this enforces it, because
 * robots.txt is advisory. /robots.txt stays reachable (a crawler that cannot
 * read it never learns it is disallowed) — see the matcher below.
 *
 * Search engines and AI search crawlers that produce real referrals are
 * deliberately NOT listed: they are why the site is indexed at all.
 */
const BLOCKED_CRAWLERS = [
  "serankingbacklinksbot",
  "ahrefsbot",
  "semrushbot",
  "mj12bot",
  "dotbot",
  "blexbot",
  "barkrowler",
  "dataforseobot",
  "megaindex",
  "internetmeasurement",
]

export function middleware(request: NextRequest) {
  const ua = request.headers.get("user-agent")?.toLowerCase() ?? ""
  if (ua && BLOCKED_CRAWLERS.some((bot) => ua.includes(bot))) {
    return new NextResponse("Not available to this crawler. See /robots.txt.\n", {
      status: 403,
      headers: { "content-type": "text/plain", "cache-control": "no-store" },
    })
  }
  return NextResponse.next()
}

export const config = {
  // Admin auth is enforced in app/admin/layout.tsx (needs a DB session, which is
  // not available in the Edge runtime). This matcher exists only for crawler
  // refusal, so it skips Next internals, static assets, and the two files a
  // crawler must always be able to read.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
}
