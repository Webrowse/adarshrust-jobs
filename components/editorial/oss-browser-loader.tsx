"use client"

import { useEffect, useState } from "react"
import type { OSSListRepo } from "@/content/oss-paths"
import { OSSBrowser } from "./oss-browser"

/**
 * Feeds OSSBrowser its dataset without putting the dataset in the page.
 *
 * `initial` is the first screen of cards, server-rendered so the page has real
 * content for crawlers and paints instantly. The rest of the corpus arrives
 * from /oss-index.json — a static file the browser and Cloudflare both cache,
 * which keeps ~5 MB out of every /oss response. See
 * scripts/build-oss-index.mjs for why.
 *
 * Until the fetch resolves the browser filters over `initial` only. That is a
 * visible-but-brief inconsistency in the facet counts, and the tradeoff the
 * static-asset approach buys: the default view is correct and immediate, and
 * the full set lands before most visitors reach for a filter.
 */
export function OSSBrowserLoader({
  initial,
  depPageCounts,
  companyByOwner,
}: {
  initial: OSSListRepo[]
  depPageCounts?: Record<string, number>
  companyByOwner?: Record<string, { slug: string; name: string }>
}) {
  const [repos, setRepos] = useState<OSSListRepo[]>(initial)

  useEffect(() => {
    let cancelled = false
    fetch("/oss-index.json")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((full: OSSListRepo[]) => {
        if (!cancelled && Array.isArray(full) && full.length > 0) setRepos(full)
      })
      .catch(() => {
        // Keep the server-rendered subset. A failed fetch degrades the browser
        // to the top repos rather than emptying the page.
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <OSSBrowser repos={repos} depPageCounts={depPageCounts} companyByOwner={companyByOwner} />
  )
}
