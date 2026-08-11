import { prisma } from "@/lib/prisma"
import type { ContentType } from "@/lib/admin/types"
import { normalizeUrl } from "@/lib/admin/lists"

/**
 * Pipeline data access. Writes published content directly to content_items
 * (the source of truth); the build regenerates content/*.json from it.
 */

/** Published data objects for a type (read-only input for scanners like careers). */
export async function readPublished(type: ContentType): Promise<Record<string, unknown>[]> {
  // (createdAt, id) is a stable total order: id breaks createdAt ties so the
  // exported snapshot is byte-identical for identical DB state.
  const rows = await prisma.contentItem.findMany({ where: { type }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] })
  return rows.map((r) => r.data as Record<string, unknown>)
}

/** Set of normalised hrefs already published for a type (for dedup). */
export async function publishedHrefSet(type: ContentType): Promise<Set<string>> {
  const rows = await prisma.contentItem.findMany({
    where: { type },
    select: { href: true, data: true },
  })
  const set = new Set<string>()
  for (const r of rows) {
    if (r.href) set.add(normalizeUrl(r.href))
    const dataHref = String((r.data as Record<string, unknown>)?.href ?? "")
    if (dataHref) set.add(normalizeUrl(dataHref))
  }
  return set
}

/** Set of slugs already published for a type (for dedup). */
export async function publishedSlugSet(type: ContentType): Promise<Set<string>> {
  const rows = await prisma.contentItem.findMany({ where: { type }, select: { data: true } })
  const set = new Set<string>()
  for (const r of rows) {
    const slug = String((r.data as Record<string, unknown>)?.slug ?? "")
    if (slug) set.add(slug)
  }
  return set
}

/**
 * Insert accepted items for a type. DB only; JSON is a build artifact.
 *
 * Slug collisions are rejected here rather than at each call site, because this
 * is the one choke point every scanner reaches. Callers already de-duplicate on
 * `href`, but the public routes resolve on `slug` — so one entity reachable at
 * two URLs (deno.com and deno.land, a marketing site and a GitHub org, a single
 * job posting mirrored under two aggregator ids) passes the href check and lands
 * as a second row sharing one slug. The result is a duplicate <loc> in
 * sitemap.xml and a page lookup that silently resolves to whichever row sorts
 * first. Seven such rows accumulated before this guard existed; see
 * scripts/dedupe-by-slug.ts, which cleans up any that predate it.
 *
 * The first row to claim a slug keeps it. Items without a slug are unaffected -
 * not every content type has one, and there is nothing to collide on.
 */
export async function publishBatch(type: ContentType, items: Record<string, unknown>[]): Promise<number> {
  if (items.length === 0) return 0

  // Seeded from the database, then extended as the batch is walked, so a batch
  // that contains the same slug twice inserts it once.
  const claimed = await publishedSlugSet(type)
  const accepted = items.filter((item) => {
    const slug = String(item.slug ?? "")
    if (!slug) return true
    if (claimed.has(slug)) return false
    claimed.add(slug)
    return true
  })
  if (accepted.length === 0) return 0

  await prisma.contentItem.createMany({
    data: accepted.map((item) => ({
      type,
      href: String(item.href ?? "") || null,
      data: item as never,
    })),
  })
  return accepted.length
}

/** Remove published items of a type whose expiresAt is before today. */
export async function removeExpired(type: ContentType, today: string): Promise<number> {
  const rows = await prisma.contentItem.findMany({ where: { type }, select: { id: true, data: true } })
  const expiredIds = rows
    .filter((r) => {
      const exp = String((r.data as Record<string, unknown>)?.expiresAt ?? "")
      return exp !== "" && exp < today
    })
    .map((r) => r.id)
  if (expiredIds.length === 0) return 0
  await prisma.contentItem.deleteMany({ where: { id: { in: expiredIds } } })
  return expiredIds.length
}
