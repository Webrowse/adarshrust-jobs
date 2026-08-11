// Temporary memory-usage logging for the Railway memory investigation.
// Remove once the /oss static-conversion fix is confirmed to hold memory flat.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return

  const m = process.memoryUsage()
  console.log(
    "[mem] server start",
    `rss=${(m.rss / 1048576).toFixed(1)}MB`,
    `heapUsed=${(m.heapUsed / 1048576).toFixed(1)}MB`,
  )

  void purgeEdgeCache()
}

/**
 * Drop Cloudflare's cached copy of every page, once, on server start.
 *
 * The edge cache rule honours the origin's `s-maxage=31536000`, so a page can
 * sit at the edge for a year - which is correct, since prerendered pages only
 * change when a new build replaces them. That makes boot the exact moment the
 * cache must be dropped: the Postgres snapshot is published as a commit, the
 * commit triggers a Railway build, and the new HTML only exists once this
 * process is running. Purging any earlier would just re-cache the old pages.
 *
 * Deliberately not awaited and never throws: a failed purge must not delay or
 * break startup. Worst case the edge serves the previous build until the next
 * deploy, which is the same situation as before this existed.
 */
async function purgeEdgeCache() {
  const zone = process.env.CLOUDFLARE_ZONE_ID
  const token = process.env.CLOUDFLARE_PURGE_TOKEN
  // Absent locally and in preview - purging is a production-only concern.
  if (!zone || !token) return

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
    } else {
      console.error("[cache] purge rejected:", res.status, JSON.stringify(body.errors))
    }
  } catch (err) {
    console.error("[cache] purge failed:", (err as Error)?.message ?? String(err))
  }
}
