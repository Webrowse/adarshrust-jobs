/**
 * Writes public/oss-index.json — the full repo list the /oss browser filters on.
 *
 * Why this is a static asset rather than page props: /oss used to embed all
 * ~5,400 repos in the page itself, which Next serialises twice (once in the
 * server-rendered HTML, once in the RSC payload). That made /oss a ~6 MB
 * response and the single heaviest thing the server could be asked for — and
 * Railway billed memory per minute, so every crawler sweep of that page moved
 * the invoice. The DOM-level pagination added earlier capped rendered cards at
 * 100 but shipped the whole corpus regardless.
 *
 * As a file under public/ it is fetched once, cached by the browser and by
 * Cloudflare at the edge, and never rebuilt into the HTML. The page now embeds
 * only the first screen of cards.
 *
 * Shape is exactly OSSListRepo[] (see content/oss-paths.ts) so the browser can
 * use it verbatim. Deliberately not compressed or interned: gzip already
 * collapses the repeated crate names, and a plain array keeps the loader
 * trivial.
 *
 * Usage: node scripts/build-oss-index.mjs   (runs in prebuild)
 */
import { readFileSync, writeFileSync } from "fs"
import { join, dirname } from "path"
import { fileURLToPath } from "url"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const IN = join(ROOT, "content", "oss-list.json")
const OUT = join(ROOT, "public", "oss-index.json")

const repos = JSON.parse(readFileSync(IN, "utf-8"))

// Exactly the fields components/editorial/oss-browser.tsx reads. Anything else
// is dead weight on a payload every visitor downloads.
const index = repos.map((r) => ({
  name: r.name,
  owner: r.owner,
  href: r.href,
  note: r.note,
  stars: r.stars,
  forks: r.forks,
  openIssuesCount: r.openIssuesCount,
  topics: r.topics,
  license: r.license,
  kind: r.kind,
  activityTier: r.activityTier,
  dependencies: r.dependencies,
  labels: r.labels,
  pushedAt: r.pushedAt,
  technologies: r.ecosystemIntelligence?.technologies,
}))

const payload = JSON.stringify(index)
writeFileSync(OUT, payload)

console.log(
  `✓ oss-index.json — ${index.length} repos, ${(Buffer.byteLength(payload) / 1048576).toFixed(2)} MB`
)
