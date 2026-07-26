import { scoreJobText, shouldQueue } from "@/lib/admin/prefilter"
import type { ScanResult, Candidate, ScanContext } from "@/lib/pipeline/types"
import type { ScanLog } from "@/lib/admin/types"
import { decodeHTML, stripHtml, extractMinimalJob } from "./shared"

/**
 * We Work Remotely scanner core — Category 1 (structured).
 *
 * WWR publishes a public RSS feed per category; the programming feed is
 * parsed deterministically (same regex-block approach as rust-bytes.ts).
 * Titles follow a consistent "Company: Role" format. Rust relevance is the
 * same deterministic scoreJobText/shouldQueue gate careers.ts uses — no
 * DeepSeek needed, the feed is already structured. ctx.isKnown skips listings
 * already published.
 */

const WWR_FEED = "https://weworkremotely.com/categories/remote-programming-jobs.rss"

type WWRItem = { title: string; description: string; link: string; pubDate?: string }

function tag(block: string, name: string): string {
  const m = block.match(new RegExp(`<${name}>([\\s\\S]*?)<\\/${name}>`))
  return m ? m[1].trim() : ""
}

async function fetchWWRItems(limit = 60): Promise<WWRItem[]> {
  try {
    const res = await fetch(WWR_FEED, {
      signal: AbortSignal.timeout(15_000),
      headers: { "User-Agent": "osspath.com/scanner" },
      next: { revalidate: 0 },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const xml = await res.text()

    const items: WWRItem[] = []
    const itemRe = /<item>([\s\S]*?)<\/item>/g
    let m: RegExpExecArray | null
    while ((m = itemRe.exec(xml)) !== null && items.length < limit) {
      const block = m[1]
      const title = tag(block, "title")
      const description = tag(block, "description")
      const link = tag(block, "link")
      const pubDate = tag(block, "pubDate")
      if (title && link) items.push({ title, description, link, pubDate })
    }
    return items
  } catch {
    return []
  }
}

export async function collectWeWorkRemotely(ctx: ScanContext): Promise<ScanResult> {
  const log: ScanLog = {
    source: "weworkremotely", startedAt: new Date().toISOString(),
    found: 0, added: 0, skipped: 0, errors: [], stages: {}, notes: [],
  }
  const items: Candidate[] = []

  const feedItems = await fetchWWRItems(60)
  log.stages!.fetched = feedItems.length
  if (feedItems.length === 0) {
    log.errors.push("Could not fetch We Work Remotely feed — check network or URL")
    log.finishedAt = new Date().toISOString()
    return { log, items }
  }

  let dupCount = 0
  let nonRustCount = 0

  for (const item of feedItems) {
    // WWR titles are consistently "Company: Role".
    const sep = item.title.indexOf(": ")
    const company = sep > -1 ? item.title.slice(0, sep).trim() : ""
    const role = sep > -1 ? item.title.slice(sep + 2).trim() : item.title.trim()
    if (!company || !role) continue

    const desc = stripHtml(decodeHTML(item.description))
    const full = `${role} ${desc}`
    if (!/\brust\b/i.test(full)) { nonRustCount++; continue }

    const score = scoreJobText(full)
    if (!shouldQueue(score)) { nonRustCount++; continue }

    const href = item.link
    if (ctx.isKnown(href)) { dupCount++; continue }

    items.push({
      id: `wwr-${href}`,
      type: "jobs", status: "pending", source: "weworkremotely",
      sourceUrl: href, foundAt: item.pubDate ?? new Date().toISOString(),
      confidence: 0.8, score: score.total,
      whyMatched: `We Work Remotely: ${score.reasons.join(" · ")}`,
      rawText: `${role} @ ${company}\n${desc}`.slice(0, 800),
      extracted: {
        ...extractMinimalJob(full),
        company,
        role,
        href,
      },
    })
    log.found++
  }

  log.skipped = dupCount + nonRustCount
  log.stages!.queued = items.length
  log.stages!.duplicates = dupCount
  log.stages!.nonRustOrLowScore = nonRustCount
  log.finishedAt = new Date().toISOString()
  return { log, items }
}
