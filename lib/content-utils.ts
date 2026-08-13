/**
 * Utilities for curated content: expiry filtering, freshness display,
 * and stale-content detection for the review workflow.
 *
 * All comparisons use the build-time date (Date.now() at render),
 * which is correct for statically-generated pages.
 */

// How often each content type should be re-verified.
// Content past its interval appears in validate-content output.
export const REVIEW_INTERVALS = {
  jobs:      7,   // days
  grants:    14,
  // The OSS corpus is machine-refreshed (weekly GitHub-refresh cron batches),
  // not hand-reviewed: 30 days was written for a ~50-repo curated list and at
  // 5,000+ repos flagged nearly the whole corpus. 120d marks genuine neglect.
  oss:       120,
  events:    14,
  pulse:     60,
  companies: 60,
} as const

export type ContentType = keyof typeof REVIEW_INTERVALS

// ── Expiry ────────────────────────────────────────────────────────────────────

export function isActive(expiresAt?: string): boolean {
  if (!expiresAt) return true
  return new Date(expiresAt) > new Date()
}

export function filterActive<T extends { expiresAt?: string }>(items: T[]): T[] {
  return items.filter((item) => isActive(item.expiresAt))
}

// ── Staleness ─────────────────────────────────────────────────────────────────

/** Days since last check. Returns null if checkedAt is absent. */
export function daysSinceCheck(checkedAt?: string): number | null {
  if (!checkedAt) return null
  return Math.floor((Date.now() - new Date(checkedAt).getTime()) / 86400000)
}

/** True when the item is overdue for review but not yet expired. */
export function isStale(type: ContentType, checkedAt?: string): boolean {
  const days = daysSinceCheck(checkedAt)
  if (days === null) return true
  return days > REVIEW_INTERVALS[type]
}

// ── Freshness display ─────────────────────────────────────────────────────────

export function formatCheckedAt(checkedAt?: string): string | null {
  if (!checkedAt) return null
  const days = daysSinceCheck(checkedAt)
  if (days === null || days < 0) return null
  if (days === 0) return "Reviewed today"
  if (days <= 6)  return `Reviewed ${days}d ago`
  if (days <= 27) return `Reviewed ${Math.floor(days / 7)}w ago`
  return `Last reviewed ${new Date(checkedAt).toLocaleDateString("en-US", { month: "short", year: "numeric" })}`
}

// ── Search ────────────────────────────────────────────────────────────────────

/** Case-insensitive substring match across string values and string arrays (aliases, topics, ecosystems). */
export function matchesQuery(item: Record<string, unknown>, query: string): boolean {
  if (!query.trim()) return true
  const q = query.toLowerCase()
  return Object.values(item).some((v) => {
    if (typeof v === "string") return v.toLowerCase().includes(q)
    if (Array.isArray(v)) return v.some(s => typeof s === "string" && s.toLowerCase().includes(q))
    return false
  })
}
