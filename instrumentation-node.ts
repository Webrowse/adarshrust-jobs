import { readFile } from "fs/promises"
import { join } from "path"
import { prisma } from "@/lib/prisma"

// Node-runtime boot work. Only ever loaded via instrumentation.ts's
// NEXT_RUNTIME === "nodejs" gate — never import this from route code.

export async function onServerBoot() {
  // Temporary memory-usage logging for the Railway memory investigation.
  // Remove once the /oss static-conversion fix is confirmed to hold memory flat.
  const m = process.memoryUsage()
  console.log(
    "[mem] server start",
    `rss=${(m.rss / 1048576).toFixed(1)}MB`,
    `heapUsed=${(m.heapUsed / 1048576).toFixed(1)}MB`,
  )

  void purgeEdgeCache()
}

/**
 * Drop Cloudflare's cached copy of every page — once per BUILD, not per boot.
 *
 * The edge cache rule honours the origin's `s-maxage=31536000`, so a page can
 * sit at the edge for a year - which is correct, since prerendered pages only
 * change when a new build replaces them. That makes the first boot of a new
 * build the exact moment the cache must be dropped: the Postgres snapshot is
 * published as a commit, the commit triggers a Railway build, and the new HTML
 * only exists once this process is running.
 *
 * A plain container restart of the SAME build must not purge: the origin still
 * serves byte-identical pages and assets, so dumping the edge would only push
 * traffic (and memory) back to the origin — and it is what makes scheduled
 * restarts affordable. The gate is the Next build id, recorded in Postgres
 * after a successful purge. Deliberately not the content hash: even a
 * docs-only deploy embeds new /_next/static asset URLs in every page's HTML,
 * so any new build must purge or the edge serves HTML pointing at assets the
 * origin no longer has.
 *
 * Fails toward purging: unreadable build id, missing marker table (P2021,
 * before `npm run db:sync-schema`), or any DB error just means "purge like
 * before". Deliberately not awaited and never throws: a failed purge must not
 * delay or break startup.
 */
async function purgeEdgeCache() {
  const zone = process.env.CLOUDFLARE_ZONE_ID
  const token = process.env.CLOUDFLARE_PURGE_TOKEN
  // Absent locally and in preview - purging is a production-only concern.
  if (!zone || !token) return

  const buildId = await readBuildId()
  if (buildId && (await alreadyPurged(buildId))) {
    console.log(`[cache] skip purge: build ${buildId} already purged the edge (container restart)`)
    return
  }

  try {
    const res = await fetch(`https://api.cloudflare.com/client/v4/zones/${zone}/purge_cache`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ purge_everything: true }),
    })
    const body = (await res.json()) as { success?: boolean; errors?: unknown }
    if (res.ok && body.success) {
      console.log("[cache] purged Cloudflare edge cache on boot")
      if (buildId) await recordPurged(buildId)
    } else {
      console.error("[cache] purge rejected:", res.status, JSON.stringify(body.errors))
    }
  } catch (err) {
    console.error("[cache] purge failed:", (err as Error)?.message ?? String(err))
  }
}

/** The running build's id, or null if it cannot be read (then we just purge). */
async function readBuildId(): Promise<string | null> {
  try {
    const id = (await readFile(join(process.cwd(), ".next", "BUILD_ID"), "utf-8")).trim()
    return id || null
  } catch {
    return null
  }
}

async function alreadyPurged(buildId: string): Promise<boolean> {
  try {
    const row = await prisma.edgeCacheMarker.findUnique({ where: { id: "singleton" } })
    return row?.buildId === buildId
  } catch {
    // Marker table missing or DB unreachable: purge as if the gate didn't exist.
    return false
  }
}

async function recordPurged(buildId: string): Promise<void> {
  try {
    await prisma.edgeCacheMarker.upsert({
      where: { id: "singleton" },
      create: { id: "singleton", buildId },
      update: { buildId },
    })
  } catch (err) {
    console.warn(
      "[cache] purge succeeded but marker write failed (next restart will purge again):",
      (err as Error)?.message ?? String(err),
    )
  }
}
