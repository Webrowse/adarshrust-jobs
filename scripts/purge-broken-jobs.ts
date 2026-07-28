/**
 * CLI: delete published job rows left behind by a failed extraction.
 *
 * A scanner that fails to extract a listing can still publish a ContentItem
 * whose data has no role and no company, with the fallback slug "job". Those
 * rows render as blank cards and previously shipped title-less entries into
 * public/search-index.json, which threw on every keystroke in the command
 * palette. lib/pipeline/scan/hn.ts now skips incomplete extractions and the
 * readers filter defensively; this removes the rows already in the database.
 *
 * Dry run by default - prints what it would delete and touches nothing.
 * Pass --apply to actually delete.
 *
 * Run: tsx scripts/purge-broken-jobs.ts [--apply]
 */
import { config } from "dotenv"

// Load env before the Prisma client is constructed (dynamic import in main()).
config({ path: ".env.local" })
config()

const APPLY = process.argv.includes("--apply")

function isBroken(data: Record<string, unknown>): boolean {
  const slug = typeof data.slug === "string" ? data.slug : ""
  const role = typeof data.role === "string" ? data.role.trim() : ""
  const company = typeof data.company === "string" ? data.company.trim() : ""
  return !slug || slug === "job" || !role || !company
}

async function main() {
  const { prisma } = await import("@/lib/prisma")

  const rows = await prisma.contentItem.findMany({
    where: { type: "jobs" },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  })

  const broken = rows.filter((r) => isBroken(r.data as Record<string, unknown>))

  console.log(`  ${rows.length} published jobs, ${broken.length} broken`)
  for (const r of broken) {
    const data = r.data as Record<string, unknown>
    const note = typeof data.note === "string" ? data.note.replace(/\s+/g, " ").slice(0, 70) : ""
    console.log(`  - ${r.id}  slug=${JSON.stringify(data.slug)}  ${note}`)
  }

  if (broken.length === 0) {
    console.log("\n✓ nothing to purge")
    return
  }

  if (!APPLY) {
    console.log("\n  dry run - re-run with --apply to delete these rows")
    return
  }

  const { count } = await prisma.contentItem.deleteMany({ where: { id: { in: broken.map((r) => r.id) } } })
  console.log(`\n✓ deleted ${count} rows - run npm run db:export to refresh content/jobs.json`)
}

main().catch((err) => {
  console.error(`✗ purge-broken-jobs: ${(err as Error)?.message ?? err}`)
  process.exit(1)
})
