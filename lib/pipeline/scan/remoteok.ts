import { scoreJobText, shouldQueue } from "@/lib/admin/prefilter"
import type { ScanResult, Candidate, ScanContext } from "@/lib/pipeline/types"
import type { ScanLog } from "@/lib/admin/types"
import { stripHtml, extractMinimalJob } from "./shared"

/**
 * RemoteOK scanner core — Category 1 (structured).
 *
 * RemoteOK's public JSON API returns every listing (no server-side tag
 * filtering that actually works), so Rust relevance is entirely the
 * deterministic prefilter here — same scoreJobText/shouldQueue gate careers.ts
 * uses. No DeepSeek: position, company, and apply URL come straight off the
 * structured response. ctx.isKnown skips postings already published.
 *
 * API terms (https://remoteok.com/api) ask for a link-back to RemoteOK as the
 * source, which the published job record satisfies via its own listing link.
 */

const REMOTEOK_API = "https://remoteok.com/api"

type RemoteOKJob = {
  id?: string
  position?: string
  company?: string
  description?: string
  tags?: string[]
  apply_url?: string
  url?: string
  date?: string
}

export async function collectRemoteOK(ctx: ScanContext): Promise<ScanResult> {
  const log: ScanLog = {
    source: "remoteok", startedAt: new Date().toISOString(),
    found: 0, added: 0, skipped: 0, errors: [], stages: {}, notes: [],
  }
  const items: Candidate[] = []

  let jobs: RemoteOKJob[]
  try {
    const res = await fetch(REMOTEOK_API, {
      signal: AbortSignal.timeout(15_000),
      headers: { "User-Agent": "osspath.com/scanner" },
      next: { revalidate: 0 },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = (await res.json()) as RemoteOKJob[]
    // First element is always an API legal/notice object, not a job.
    jobs = data.filter((j) => j.id && j.position)
  } catch (e) {
    log.errors.push(`Failed to fetch RemoteOK API: ${String(e)}`)
    log.finishedAt = new Date().toISOString()
    return { log, items }
  }
  log.stages!.fetched = jobs.length

  let dupCount = 0
  let nonRustCount = 0

  for (const job of jobs) {
    const position = String(job.position ?? "")
    const company = String(job.company ?? "")
    const desc = stripHtml(String(job.description ?? ""))
    const tags = (job.tags ?? []).join(" ")
    const full = `${position} ${tags} ${desc}`
    if (!/\brust\b/i.test(full)) { nonRustCount++; continue }

    const score = scoreJobText(full)
    if (!shouldQueue(score)) { nonRustCount++; continue }

    const href = String(job.apply_url || job.url || "")
    if (!href) continue
    if (ctx.isKnown(href)) { dupCount++; continue }

    items.push({
      id: `remoteok-${job.id}`,
      type: "jobs", status: "pending", source: "remoteok",
      sourceUrl: href, foundAt: job.date ?? new Date().toISOString(),
      confidence: 0.8, score: score.total,
      whyMatched: `RemoteOK: ${score.reasons.join(" · ")}`,
      rawText: `${position} @ ${company}\n${desc}`.slice(0, 800),
      extracted: {
        ...extractMinimalJob(full),
        company,
        role: position,
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
