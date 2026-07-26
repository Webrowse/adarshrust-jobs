import { scoreJobText, shouldQueue } from "@/lib/admin/prefilter"
import type { ScanResult, Candidate, ScanContext } from "@/lib/pipeline/types"
import type { ScanLog } from "@/lib/admin/types"
import { sleep, extractMinimalJob } from "./shared"

/**
 * rustler.in scanner core — Category 2 (semi-structured).
 *
 * rustler.in has no public API, but its sitemap lists every job page and
 * each page is server-rendered with a consistent
 * "{role} at {company} | Rustler" <title> plus a full <meta description>.
 * That's deterministic enough to skip DeepSeek — same regex-extraction
 * approach as the RSS-based scanners, just over sitemap URLs instead of feed
 * items. Job IDs are LinkedIn-prefixed ("li:..."), meaning rustler.in itself
 * aggregates from LinkedIn; the published href points at the rustler.in page
 * (not LinkedIn directly), consistent with how careers.ts links to the
 * original ATS posting rather than a scraped mirror. ctx.isKnown skips pages
 * already published, so cost tracks new listings, not the full sitemap.
 */

const SITEMAP_URL = "https://rustler.in/sitemap.xml"
const UA = { "User-Agent": "osspath.com/scanner" }
const BATCH_SIZE = 5

async function fetchJobUrls(): Promise<string[]> {
  try {
    const res = await fetch(SITEMAP_URL, { signal: AbortSignal.timeout(15_000), headers: UA, next: { revalidate: 0 } })
    if (!res.ok) return []
    const xml = await res.text()
    const urls = [...xml.matchAll(/<loc>(https:\/\/rustler\.in\/jobs\/[^<]+)<\/loc>/g)].map((m) => m[1])
    return [...new Set(urls)]
  } catch {
    return []
  }
}

type ParsedJobPage = { role: string; company: string; description: string } | null

function parseJobPage(html: string): ParsedJobPage {
  const titleMatch = html.match(/<title>([\s\S]*?)<\/title>/)
  if (!titleMatch) return null
  const title = titleMatch[1].trim()

  // Observed format: "{role}[ | {location/remote}...] at {company} | Rustler"
  const m = title.match(/^(.+?)\s+at\s+([^|]+?)\s*\|\s*Rustler\s*$/i)
  if (!m) return null
  const role = m[1].split("|")[0].trim()
  const company = m[2].trim()
  if (!role || !company) return null

  const descMatch = html.match(/<meta name="description" content="([^"]*)"/)
  const description = descMatch ? descMatch[1] : ""

  return { role, company, description }
}

async function fetchAndParse(url: string): Promise<ParsedJobPage> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000), headers: UA, next: { revalidate: 0 } })
    if (!res.ok) return null
    return parseJobPage(await res.text())
  } catch {
    return null
  }
}

export async function collectRustlerIn(ctx: ScanContext): Promise<ScanResult> {
  const log: ScanLog = {
    source: "rustler-in", startedAt: new Date().toISOString(),
    found: 0, added: 0, skipped: 0, errors: [], stages: {}, notes: [],
  }
  const items: Candidate[] = []

  const allUrls = await fetchJobUrls()
  log.stages!.sitemapUrls = allUrls.length
  if (allUrls.length === 0) {
    log.errors.push("Could not fetch rustler.in sitemap — check network or URL")
    log.finishedAt = new Date().toISOString()
    return { log, items }
  }

  const newUrls = allUrls.filter((u) => !ctx.isKnown(u))
  const dupCount = allUrls.length - newUrls.length
  log.stages!.newUrls = newUrls.length

  let nonRustCount = 0
  let parseErrors = 0

  for (let i = 0; i < newUrls.length; i += BATCH_SIZE) {
    const batch = newUrls.slice(i, i + BATCH_SIZE)
    const parsed = await Promise.all(batch.map((url) => fetchAndParse(url).then((p) => ({ url, p }))))

    for (const { url, p } of parsed) {
      if (!p) { parseErrors++; continue }
      const full = `${p.role} ${p.description}`
      if (!/\brust\b/i.test(full)) { nonRustCount++; continue }

      const score = scoreJobText(full)
      if (!shouldQueue(score)) { nonRustCount++; continue }

      items.push({
        id: `rustler-in-${url}`,
        type: "jobs", status: "pending", source: "rustler-in",
        sourceUrl: url, foundAt: new Date().toISOString(),
        confidence: 0.8, score: score.total,
        whyMatched: `rustler.in: ${score.reasons.join(" · ")}`,
        rawText: `${p.role} @ ${p.company}\n${p.description}`.slice(0, 800),
        extracted: {
          ...extractMinimalJob(full),
          company: p.company,
          role: p.role,
          href: url,
        },
      })
      log.found++
    }

    if (i + BATCH_SIZE < newUrls.length) await sleep(400)
  }

  log.skipped = dupCount + nonRustCount + parseErrors
  log.stages!.queued = items.length
  log.stages!.duplicates = dupCount
  log.stages!.nonRustOrLowScore = nonRustCount
  if (parseErrors > 0) log.errors.push(`${parseErrors} job page(s) failed to fetch or didn't match the expected title format`)
  log.finishedAt = new Date().toISOString()
  return { log, items }
}
