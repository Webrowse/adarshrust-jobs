import { prisma } from "@/lib/prisma"

/**
 * Write many content_items `data` blobs in as few round trips as possible.
 *
 * Tier 2's processors used to write one row per `prisma.contentItem.update()`,
 * which is ~11,200 sequential statements across relationships + ecosystem. That
 * was free when the app and Postgres shared a Railway region (~1 ms), and cost
 * ~20 minutes for relationships alone once the job moved to a GitHub runner
 * talking to Neon in ap-southeast-1 at ~212 ms per round trip (measured
 * 2026-08-15). The work never changed - only the number of times it crossed a
 * network.
 *
 * One statement per chunk collapses that to `ceil(n / CHUNK)` round trips.
 *
 * `updatedAt` is set explicitly because `@updatedAt` is applied by Prisma
 * Client, not by the database, so raw SQL would otherwise leave it stale - and
 * `hasUnpublishedWrites()` compares `MAX(updatedAt)` against the last publish
 * to decide whether the admin shows "Republish to ship them".
 */

/**
 * Rows per statement. Two bind parameters each, so this is far under
 * PostgreSQL's 65535-parameter ceiling; the real limit is how much serialised
 * JSON is worth holding in one request body.
 */
const CHUNK = 500

export async function bulkUpdateData(
  updates: { id: string; data: unknown }[],
): Promise<number> {
  let affected = 0

  for (let i = 0; i < updates.length; i += CHUNK) {
    const chunk = updates.slice(i, i + CHUNK)

    // Placeholders are built from indices, never from row content; the values
    // themselves stay bound parameters.
    const tuples = chunk.map((_, j) => `($${j * 2 + 1}::text, $${j * 2 + 2}::jsonb)`).join(", ")
    const params = chunk.flatMap((u) => [u.id, JSON.stringify(u.data)])

    affected += await prisma.$executeRawUnsafe(
      `UPDATE content_items AS c
          SET data = v.data, "updatedAt" = now()
         FROM (VALUES ${tuples}) AS v(id, data)
        WHERE c.id = v.id`,
      ...params,
    )
  }

  return affected
}
