"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import type { OSSListRepo } from "@/content/oss-paths"
import { getEcoTags, ECO_LABEL } from "@/lib/eco-tags"

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1000)      return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`
  return String(n)
}

const CARD_DEP_FLOOR = 40

function pickDepLinks(
  deps: string[] | undefined,
  depPageCounts: Record<string, number>,
  limit: number
): string[] {
  if (!deps?.length) return []
  const qualified = deps.filter((d) => d in depPageCounts)
  const preferred = qualified
    .filter((d) => (depPageCounts[d] ?? 0) >= CARD_DEP_FLOOR)
    .sort((a, b) => (depPageCounts[a] ?? 0) - (depPageCounts[b] ?? 0))
    .slice(0, limit)
  if (preferred.length >= limit) return preferred
  const preferredSet = new Set(preferred)
  const fallback = qualified
    .filter((d) => !preferredSet.has(d))
    .sort((a, b) => (depPageCounts[a] ?? 0) - (depPageCounts[b] ?? 0))
    .slice(0, limit - preferred.length)
  return [...preferred, ...fallback]
}

export function OSSCard({
  repo,
  depPageCounts,
}: {
  repo: OSSListRepo
  depPageCounts?: Record<string, number>
}) {
  const router    = useRouter()
  const stars      = repo.stars           ?? 0
  const forks      = repo.forks           ?? 0
  const openIssues = repo.openIssuesCount ?? 0
  const tier       = repo.activityTier    ?? "dormant"
  const depLinks   = depPageCounts ? pickDepLinks(repo.dependencies, depPageCounts, 3) : []
  const ecoTags    = getEcoTags(repo.dependencies, { owner: repo.owner ?? undefined, name: repo.name ?? undefined, topics: repo.topics ?? undefined })
  const issueWarm  = tier === "active" && openIssues >= 5
  const isNewsletterPick = repo.labels?.includes("newsletter-pick")

  const detailHref = repo.owner && repo.name
    ? `/oss/${repo.owner}/${repo.name}`
    : null

  const statParts: string[] = []
  if (forks > 0) statParts.push(`⑂ ${fmt(forks)}`)

  function handleClick(e: React.MouseEvent) {
    // Let link clicks (dep links, eco tags) bubble without navigating the card
    const target = e.target as HTMLElement
    if (target.closest("a")) return
    if (detailHref) {
      router.push(detailHref)
    } else {
      window.open(repo.href, "_blank", "noopener,noreferrer")
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault()
      if (detailHref) {
        router.push(detailHref)
      } else {
        window.open(repo.href, "_blank", "noopener,noreferrer")
      }
    }
  }

  return (
    <article
      className="e-oss"
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      role="link"
      tabIndex={0}
      aria-label={`View ${repo.name}`}
    >
      <div className="e-oss__head">
        {/* A real anchor, not just the card's router.push: this is the only
            crawlable path from /oss to the 5,000+ repo detail pages. */}
        {detailHref ? (
          <Link href={detailHref} className="e-oss__name" onClick={e => e.stopPropagation()}>
            {repo.name}
          </Link>
        ) : (
          <span className="e-oss__name">{repo.name}</span>
        )}
        <span className="e-oss__stars">★ {fmt(stars)}</span>
        <span className={`e-oss__activity e-oss__activity--${tier}`}>{tier}</span>
      </div>

      {(ecoTags.length > 0 || isNewsletterPick) && (
        <div className="e-oss__eco">
          {isNewsletterPick && (
            <span className="e-oss__label-badge e-oss__label-badge--newsletter-pick">
              newsletter pick
            </span>
          )}
          {ecoTags.map(tag => (
            <Link
              key={tag}
              href={`/oss?eco=${tag}`}
              className={`e-oss__eco-badge e-oss__eco-badge--${tag}`}
              onClick={e => e.stopPropagation()}
            >
              {ECO_LABEL[tag]}
            </Link>
          ))}
        </div>
      )}

      <p className="e-oss__note">{repo.note}</p>

      <div className="e-oss__foot">
        {depLinks.length > 0 && (
          <div className="e-oss__deps">
            {depLinks.map((dep) => (
              <Link
                key={dep}
                href={`/deps/${dep}`}
                className="e-oss__dep-link"
                onClick={e => e.stopPropagation()}
              >
                {dep}
              </Link>
            ))}
          </div>
        )}
        {(statParts.length > 0 || openIssues > 0) && (
          <div className="e-oss__stats">
            {statParts.map(s => (
              <span key={s} className="e-oss__stat">{s}</span>
            ))}
            {openIssues > 0 && (
              <span className={`e-oss__stat${issueWarm ? " e-oss__stat--issues" : ""}`}>
                ◎ {fmt(openIssues)}
              </span>
            )}
          </div>
        )}
      </div>
    </article>
  )
}
