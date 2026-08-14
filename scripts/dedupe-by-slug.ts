/**
 * Merge published content rows that collide on `slug`.
 *
 * Why they exist: ingest de-duplicates on `href`, but the public routes
 * (`/ecosystem/[slug]`, `/jobs/[slug]`) resolve on `slug`. The same entity
 * reachable at two URLs — deno.com and deno.land, a marketing site and a GitHub
 * org, one LinkedIn posting mirrored under two aggregator ids — passes the href
 * check and lands as a second row sharing one slug. Symptoms: duplicate <loc>
 * entries in sitemap.xml, and a page lookup that silently resolves to whichever
 * row happens to sort first.
 *
 * Merge rule: keep the richest record in each group (most populated fields — in
 * practice the curated profile carrying description/github_org/type), lift the
 * newest `checkedAt` in the group onto it, and delete the thin stubs whose only
 * unique contribution was that timestamp. Ties break toward the oldest row.
 *
 * Usage:
 *   npx tsx scripts/dedupe-by-slug.ts            # dry run, prints the plan
 *   npx tsx scripts/dedupe-by-slug.ts --apply    # writes to Postgres
 *
 * Postgres is the source of truth, so run Republish from /admin afterwards to
 * regenerate content/*.json — editing the JSON directly gets overwritten.
 */
import dotenv from "dotenv"
dotenv.config({ path: ".env.local" })
dotenv.config()

import { PrismaClient } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"

const connectionString = process.env.DATABASE_URL!
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString, connectionTimeoutMillis: 10_000, max: 3 }),
})

const APPLY = process.argv.includes("--apply")
const TYPES = ["companies", "jobs"] as const

/**
 * Rows a failed extraction left with the fallback slug "job" are not duplicates
 * of each other in any meaningful sense - they are all broken, and deleting all
 * of them is the correct fix. scripts/purge-broken-jobs.ts owns that case.
 */
const PLACEHOLDER_SLUGS = new Set(["job"])

type Item = Record<string, unknown> & { slug?: string; name?: string; role?: string; checkedAt?: string }

/** Populated (non-empty) field count — the "richness" the merge keeps. */
function richness(data: Item): number {
  return Object.values(data).filter((v) => v !== null && v !== undefined && v !== "").length
}

function label(data: Item): string {
  return JSON.stringify(data.name ?? [data.company, data.role].filter(Boolean).join(" — ") ?? "?")
}

async function main() {
  const deleteIds: string[] = []
  const updates: Array<{ id: string; data: Item }> = []
  let scanned = 0

  for (const type of TYPES) {
    const rows = await prisma.contentItem.findMany({
      where: { type },
      select: { id: true, data: true, createdAt: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    })
    scanned += rows.length

    const bySlug = new Map<string, typeof rows>()
    for (const row of rows) {
      const slug = (row.data as Item)?.slug
      if (!slug || PLACEHOLDER_SLUGS.has(slug)) continue
      bySlug.set(slug, [...(bySlug.get(slug) ?? []), row])
    }

    const groups = [...bySlug.entries()].filter(([, group]) => group.length > 1)
    console.log(`\n--- ${type}: ${rows.length} rows, ${groups.length} colliding slugs`)

    for (const [slug, group] of groups) {
      // Stable: richest first, oldest wins a tie (group is already createdAt asc).
      const ranked = [...group].sort((a, b) => richness(b.data as Item) - richness(a.data as Item))
      const [keep, ...drop] = ranked

      const newestCheckedAt = group
        .map((r) => (r.data as Item).checkedAt)
        .filter((v): v is string => typeof v === "string" && v !== "")
        .sort()
        .at(-1)

      const kept = keep.data as Item
      const merged: Item = { ...kept }
      const checkedAtChanged = Boolean(newestCheckedAt) && kept.checkedAt !== newestCheckedAt
      if (checkedAtChanged) merged.checkedAt = newestCheckedAt

      console.log(`\n== ${slug}`)
      console.log(`   KEEP   ${keep.id}  ${label(kept)}  (${richness(kept)} fields)`)
      if (checkedAtChanged) console.log(`          checkedAt ${kept.checkedAt ?? "unset"} -> ${newestCheckedAt}`)
      for (const row of drop) {
        const d = row.data as Item
        console.log(`   DELETE ${row.id}  ${label(d)}  href=${d.href}`)
        deleteIds.push(row.id)
      }
      if (checkedAtChanged) updates.push({ id: keep.id, data: merged })
    }
  }

  console.log(
    `\nPlan: ${scanned} rows -> ${scanned - deleteIds.length}` +
      ` (${deleteIds.length} deletions, ${updates.length} checkedAt merges)`
  )

  if (!APPLY) {
    console.log("\nDry run. Re-run with --apply to write.")
    return
  }
  if (deleteIds.length === 0) return

  await prisma.$transaction([
    ...updates.map((u) =>
      prisma.contentItem.update({ where: { id: u.id }, data: { data: u.data as never } })
    ),
    prisma.contentItem.deleteMany({ where: { id: { in: deleteIds } } }),
  ])

  for (const type of TYPES) {
    console.log(`Applied. ${type} rows now: ${await prisma.contentItem.count({ where: { type } })}`)
  }
  console.log("Next: run Republish from /admin, then deploy.")
}

main()
  .catch((e) => {
    console.error("Failed:", (e as Error).message)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
