import type { SourceKind } from "@/lib/admin/sources"

/**
 * Cheap "has this source changed?" probes. Each returns a small fingerprint
 * (latest feed URL, newest post id, latest thread id) fetched with one tiny
 * request. The pipeline compares it to the stored source.fingerprint and skips
 * the full scan when unchanged — so cost tracks new content, not dataset size.
 *
 * Only feed/thread sources have a cheap signal. GitHub search sources have no
 * "changed?" endpoint (the search IS the work), so they have no probe and run
 * whenever their interval elapses.
 *
 * A probe returning null means "couldn't determine" — the pipeline then scans
 * normally rather than risk skipping real content.
 */

const UA = { "User-Agent": "osspath.com/pipeline 1.0" }

async function firstFeedLink(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(12_000), next: { revalidate: 0 } })
    if (!res.ok) return null
    const xml = await res.text()
    const item = xml.match(/<item>([\s\S]*?)<\/item>/)?.[1] ?? xml
    return item.match(/<link>(.*?)<\/link>/)?.[1]?.trim() || null
  } catch {
    return null
  }
}

export const SOURCE_PROBES: Partial<Record<SourceKind, () => Promise<string | null>>> = {
  "twir": () => firstFeedLink("https://this-week-in-rust.org/rss.xml"),

  "weworkremotely": () => firstFeedLink("https://weworkremotely.com/categories/remote-programming-jobs.rss"),

  "rust-bytes": () => firstFeedLink("https://weeklyrust.substack.com/feed"),

  "reddit": async () => {
    try {
      const res = await fetch("https://www.reddit.com/r/rust/new.json?limit=1", { headers: UA, signal: AbortSignal.timeout(12_000), next: { revalidate: 0 } })
      if (!res.ok) return null
      const data = await res.json() as { data?: { children?: { data?: { name?: string } }[] } }
      return data?.data?.children?.[0]?.data?.name ?? null
    } catch {
      return null
    }
  },

  "hn": async () => {
    try {
      const res = await fetch("https://hn.algolia.com/api/v1/search_by_date?tags=story,author_whoishiring&query=hiring&hitsPerPage=1", { signal: AbortSignal.timeout(12_000), next: { revalidate: 0 } })
      if (!res.ok) return null
      const data = await res.json() as { hits?: { objectID?: string; num_comments?: number }[] }
      const hit = data?.hits?.[0]
      // Thread id + comment count: changes when a new thread opens or new comments arrive.
      return hit ? `${hit.objectID}:${hit.num_comments ?? 0}` : null
    } catch {
      return null
    }
  },
}
