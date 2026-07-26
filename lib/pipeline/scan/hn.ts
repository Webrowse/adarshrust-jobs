import { classifyRustSignal, scoreJobText, shouldQueue, QUEUE_THRESHOLD } from "@/lib/admin/prefilter"
import { extractWithDeepSeek } from "@/lib/admin/deepseek"
import type { ScanResult, Candidate, ScanContext } from "@/lib/pipeline/types"
import type { ScanLog } from "@/lib/admin/types"
import { decodeHTML, extractMinimalJob, estimateConfidence } from "./shared"

/**
 * HN Who Is Hiring scanner core — Category 3 (unstructured).
 *
 * Hiring comments are free-form. A deterministic prefilter (strong Rust signal +
 * job score) runs first; only surviving, new comments (ctx.isKnown) are sent to
 * DeepSeek for semantic extraction, falling back to deterministic extraction if
 * DeepSeek is unavailable. Comment text is held in memory only.
 */

type HNSearchHit = {
  objectID: string
  comment_text?: string
  created_at?: string
}

async function findLatestHNHiringPost(): Promise<number | null> {
  try {
    const res = await fetch(
      "https://hn.algolia.com/api/v1/search_by_date?tags=story,author_whoishiring&query=hiring&hitsPerPage=1",
      { signal: AbortSignal.timeout(15_000), next: { revalidate: 0 } },
    )
    const data = await res.json() as { hits?: { objectID: string }[] }
    const hit = data?.hits?.[0]
    return hit ? parseInt(hit.objectID) : null
  } catch {
    return null
  }
}

export async function collectHN(ctx: ScanContext): Promise<ScanResult> {
  const log: ScanLog = {
    source: "hn-hiring", startedAt: new Date().toISOString(),
    found: 0, added: 0, skipped: 0, errors: [], stages: {}, notes: [],
  }
  const items: Candidate[] = []
  const useAI = !!process.env.DEEPSEEK_API_KEY

  const storyId = await findLatestHNHiringPost()
  if (!storyId) {
    log.errors.push("Could not locate the latest Who-is-hiring thread")
    log.finishedAt = new Date().toISOString()
    return { log, items }
  }
  log.notes!.push(`Scanning HN story ${storyId}`)

  try {
    const res = await fetch(
      `https://hn.algolia.com/api/v1/search?tags=comment,story_${storyId}&query=rust&hitsPerPage=100&attributesToRetrieve=objectID,comment_text,created_at`,
      { signal: AbortSignal.timeout(20_000), next: { revalidate: 0 } },
    )
    const data = await res.json() as { hits?: HNSearchHit[] }
    const hits: HNSearchHit[] = data?.hits ?? []
    log.found = hits.length
    log.stages!.fetched = hits.length

    let rustFiltered = 0, scoreFiltered = 0, dupFiltered = 0, extractionFailed = 0

    for (const hit of hits) {
      const text = decodeHTML(hit.comment_text ?? "")

      if (classifyRustSignal(text) !== "strong") { rustFiltered++; continue }
      const score = scoreJobText(text)
      if (!shouldQueue(score)) { scoreFiltered++; continue }

      const sourceUrl = `https://news.ycombinator.com/item?id=${hit.objectID}`
      if (ctx.isKnown(sourceUrl)) { dupFiltered++; continue }

      let extracted: Record<string, unknown>
      if (useAI) {
        const result = await extractWithDeepSeek("jobs", text)
        if (!result.ok || !result.data) {
          extracted = extractMinimalJob(text)
        } else if ((result.data as { skip?: boolean }).skip === true) {
          dupFiltered++; continue
        } else {
          extracted = result.data
        }
      } else {
        extracted = extractMinimalJob(text)
      }

      // A published job needs company + role + href to render as a real
      // listing. extractMinimalJob() (the no-AI / failed-extraction fallback)
      // deliberately can't produce those from free-form prose — publishing it
      // anyway would put a blank job card on the live site. Skip instead.
      const company = String(extracted.company ?? "").trim()
      const role = String(extracted.role ?? "").trim()
      const extractedHref = String(extracted.href ?? "").trim()
      if (!company || !role || !extractedHref) { extractionFailed++; continue }

      if (ctx.isKnown(extractedHref)) { dupFiltered++; continue }

      items.push({
        id: `hn-${hit.objectID}`,
        type: "jobs", status: "pending", source: "hn-hiring",
        sourceUrl, foundAt: hit.created_at ?? new Date().toISOString(),
        confidence: estimateConfidence(extracted), score: score.total,
        whyMatched: score.reasons.join(" · "),
        rawText: text.slice(0, 2000), extracted,
      })
    }

    log.stages!.rustFiltered = rustFiltered
    log.stages!.scoreFiltered = scoreFiltered
    log.stages!.dupFiltered = dupFiltered
    log.stages!.extractionFailed = extractionFailed
    log.stages!.queued = items.length
    log.skipped = rustFiltered + scoreFiltered + dupFiltered + extractionFailed
    if (items.length === 0 && hits.length > 0) {
      log.notes!.push(`No comments passed score threshold (${QUEUE_THRESHOLD}).`)
    }
    if (extractionFailed > 0 && !useAI) {
      log.notes!.push(`${extractionFailed} comment(s) scored as Rust jobs but skipped: no DEEPSEEK_API_KEY configured, so company/role/href couldn't be extracted from free-form text.`)
    }
  } catch (e) {
    log.errors.push(`Scan failed: ${String(e)}`)
  }

  log.finishedAt = new Date().toISOString()
  return { log, items }
}
