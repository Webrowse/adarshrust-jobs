# OSSPath

A curated map of the Rust ecosystem — jobs, repositories, crates, funding,
organizations, and community signals. Live at **[osspath.com](https://osspath.com)**.

The site is deliberately small and human-reviewed. Nothing is scraped straight
onto a page; every entry is verified before it appears. See
[CONTRIBUTING.md](CONTRIBUTING.md) for the inclusion rules.

As of 2026-08-14 the corpus is **5,607 repositories**, **1,070 crate pages**,
and around 6,900 URLs in the sitemap.

---

## What's on the site

| Area | Routes | What it is |
| --- | --- | --- |
| Jobs | `/jobs`, `/jobs/[slug]` | Remote Rust roles, reviewed one at a time |
| Repositories | `/oss`, `/oss/[owner]/[repo]` | The indexed corpus — stars, activity, license, dependencies |
| Crates | `/deps`, `/deps/[crate]` | Per-crate adoption: who uses it, companion crates, health |
| Organizations | `/ecosystem`, `/ecosystem/[slug]` | Companies and teams with real public Rust output |
| Ecosystems | `/ecosystems`, `/ecosystems/[tag]` | The corpus grouped by domain (bevy, tauri, embedded, wasm, …) |
| Topics | `/topics/[topic]` | Cross-cutting slices of the corpus |
| Funding | `/grants`, `/grants/[slug]`, `/funders`, `/funders/[slug]` | Grants, fellowships, sponsorship programmes |
| Community | `/pulse`, `/events`, `/news`, `/learning`, `/portals`, `/authors` | Newsletters, forums, conferences, reading |
| Paths | `/paths`, `/paths/[slug]` | Career routes through the ecosystem |
| Meta | `/about`, `/methodology`, `/changelog`, `/contact`, `/privacy`, `/terms` | |
| Admin | `/admin/*` | Pipeline control panel — auth required, never public |

---

## How the site works

The short version: **Postgres is the source of truth, and the public site never
talks to it.** Content travels from the database to visitors like this:

```
Postgres (Railway)
   │  admin action: Refresh / Backfill / Republish
   ▼
snapshot export ──► content/*.json ──► committed to Git (Webrowse/osspath, main)
                                          │
                                          ▼  push triggers Railway build
                                    npm run build
                                          │  prerenders every page
                                          ▼
                              Next.js static output on Railway
                                          │
                                          ▼
                              Cloudflare edge cache ──► visitors
```

Three things follow from this, and they explain most of the design:

1. **Publishing means deploying.** A snapshot publish is a Git commit, and the
   site only changes once the resulting build ships. There is no runtime
   database read on any public page.
2. **Public routes read `content/*.json`, never Prisma.** A build-time guard
   (`scripts/check-public-purity.mjs`) fails the build if a public route
   imports the database — or loads the full 24 MB corpus file, which only the
   single-repo detail page is allowed to touch.
3. **Every public page is prerendered.** The big dynamic routes set
   `dynamicParams = false`, so a URL that wasn't generated at build time
   returns a 404 instead of rendering on demand. That's intentional: it puts a
   hard ceiling on what the server can be asked to do.

### The pipeline tiers

`lib/pipeline/orchestrator.ts` owns the sequencing: **Tier 1** (scan /
backfill, supplied by the caller) → **Tier 2** (corpus intelligence) →
**Tier 3** (exports and publish). Tiers 2 and 3 only run when Tier 1 actually
changed the corpus. Entry points call the orchestrator rather than
re-implementing the sequence.

This is why a no-op Refresh correctly publishes nothing — and why forcing the
current Postgres state into Git is a separate action (**Republish**).

---

## Build

`npm run build` is preceded by a `prebuild` chain, and **the order matters**:

```
check-public-purity   → no DB imports or full-corpus loads in public routes
check-schema-sync     → database matches the Prisma schema
build-companion-index → content/oss-companion-index.json  (from content/oss.json)
build-search-index    → public/search-index.json          ┐
build-oss-list        → content/oss-list.json             │ all three read the
                        content/oss-qualified-crates.json │ companion index
build-oss-index       → public/oss-index.json             ┘
```

`build-companion-index.mjs` must stay ahead of the other build steps. If you
reorder it, a clean-state build fails with ENOENT — but a warm working tree
will hide the mistake, so verify with:

```bash
rm -f content/oss-companion-index.json content/oss-list.json \
      content/oss-qualified-crates.json public/search-index.json public/oss-index.json
npm run prebuild
```

**Generated files are not tracked.** All five outputs above are gitignored and
rebuilt on every deploy from the tracked `content/oss.json`. Tracking a
derived file has bitten this repo before: the companion index was committed
once, never regenerated, froze at a ~2,100-repo corpus, and silently withheld
538 crate pages until 2026-08-10.

### Why /oss loads its data separately

`/oss` used to embed all ~5,400 repos in the page. Next serialises client
props twice — once in the HTML, once in the RSC payload — so the page was a
**6 MB response** and the main driver of the memory bill. It now embeds only
the top 100 repos (server-rendered, so crawlers see real content) and fetches
the rest from the static `public/oss-index.json`, which the browser and
Cloudflare both cache. The page response is now ~0.4 MB.

### Which crates get a page

A crate needs **≥ 25 dependent repositories** (`DEP_PAGE_THRESHOLD` in
`lib/deps-data.ts`) to get a `/deps/[crate]` page. The count comes from the
companion index, which itself only tracks crates appearing in ≥ 6 repos
(`MIN_REPOS` in `scripts/build-companion-index.mjs`). Keep the two in sync
with the sitemap's `depUrls()`.

---

## Deployment

Railway project **distinguished-compassion**, environment `production`:

| Service | Role |
| --- | --- |
| `OssPath` | The web app. Deploys from `Webrowse/osspath` `main` |
| `osspath-backfill-batch` | Weekly cron — enriches 25 repos, Tier 1 only, never publishes |
| `osspath-github-refresh` | Weekly cron — refreshes GitHub metadata for known repos |
| `Postgres` | Source of truth |

Each cron has its own config-as-code file (`railway.backfill-batch.toml`,
`railway.github-refresh.toml`) set as that service's config path.

### Memory, because memory is the bill

Railway bills memory per minute on **average RSS**, so the average is what
costs money — not peaks, not traffic. Three mechanisms keep it down:

- **The server heap is capped.** `railway.toml` starts the server with
  `--max-old-space-size=256`, overriding the 4 GB the build needs. 256 is the
  floor: a 160 cap OOM-crashed the server in 2026-08-13, because a
  Refresh/Republish still has to build the full snapshot in memory. Don't
  lower it again without streaming the export.
- **The server restarts itself every night at 04:30 UTC**
  (`instrumentation-node.ts`). RSS drifts from ~0.21 GB at boot toward the
  ceiling over a couple of days and never returns; a clean `process.exit(0)`
  plus `restartPolicyType = "ALWAYS"` resets it daily. The restart waits if a
  pipeline run is in flight, and it does **not** purge the edge cache (see
  below).
- **The admin never materialises the full corpus.** `getAdminRepos()` projects
  the fields it needs out of the `data` jsonb in SQL instead of parsing all
  5,600 full rows (a ~105 MB heap transient) on every authenticated view.

### Edge caching

osspath.com is proxied through Cloudflare. Two cache rules: one bypasses
`/admin`, `/api` and authenticated sessions; the other caches public pages and
honours the origin's `cache-control` (`s-maxage=31536000`), with
serve-stale-while-revalidating on.

Since pages can sit at the edge for a year, the cache must be dropped exactly
when a new build goes live — and only then. `instrumentation-node.ts` purges
the Cloudflare zone **once per build**: it records the Next build id in
Postgres (`edge_cache_marker`) after a successful purge, so a container
restart of the same build (including the nightly one) skips the purge, while
every new build — even a docs-only deploy — purges, because each build embeds
new `/_next/static` asset URLs in every page.

It needs two variables on the `OssPath` service and no-ops without them:

```
CLOUDFLARE_ZONE_ID      the osspath.com zone id
CLOUDFLARE_PURGE_TOKEN  custom token: Zone · Cache Purge · Purge, scoped to osspath.com
```

Look for `[cache] purged Cloudflare edge cache on boot` (new build) or
`[cache] skip purge` (same-build restart) in the deploy logs.

### Crawler control

`middleware.ts` returns 403 to SEO/backlink crawlers by User-Agent (Ahrefs,
Semrush, MJ12, DotBot, SE Ranking and others). They send no referral traffic
but sweep the whole corpus on a loop. `app/robots.ts` asks the same crawlers
to stay away; the middleware enforces it, because robots.txt is advisory.
Search engines and AI search crawlers are deliberately **not** blocked.

---

## CI

`.github/workflows/ci.yml` runs on every push and PR: `tsc`, the purity
guard, and the seven `check:*` suites — everything that works without a
database. `check-schema-sync` is deliberately excluded (it needs
`DATABASE_URL`).

One hard-won lesson lives in the lockfile: `package-lock.json` is tracked, and
if it ever needs regenerating, do it from a clean slate
(`rm -rf node_modules package-lock.json && npm install`). A lockfile built up
through incremental installs on macOS once shipped without `resolved`/
`integrity` fields and broke the Linux build on native bindings.

---

## Local development

```bash
npm install
npx prisma generate
npm run dev            # http://localhost:3000
```

You need a `.env.local` with at least `DATABASE_URL`, `AUTH_SECRET`,
`NEXTAUTH_URL`, and `ADMIN_EMAIL`. OAuth sign-in additionally needs
`GITHUB_ID`/`GITHUB_SECRET` or `GOOGLE_ID`/`GOOGLE_SECRET`. Publishing from a
local admin session needs `GITHUB_PUBLISH_TOKEN`, `PUBLISH_REPO` and
`PUBLISH_BRANCH`.

The public site renders from the committed `content/*.json`, so most UI work
needs no database at all.

### Scripts

**Run automatically — don't run these yourself.** `check:purity` and
`check-schema-sync` run on every build via `prebuild` and fail the build if
violated. `db:backfill-batch` and `db:refresh-github` are the start commands
for the two weekly Railway cron services.

**Run when you change the schema:**

```bash
npm run db:sync-schema      # prisma db push + record schema
```

Nothing else pushes schema changes to production. Run it **before** pushing a
commit that changes `prisma/schema.prisma` — the production build fails on
confirmed schema drift.

**The check suite** — CI runs these on every push; run them locally before a
risky pipeline change:

```bash
npm run check:corpus        # corpus relationship integrity
npm run check:snapshot      # snapshot determinism
npm run check:orchestrator  # tier sequencing
npm run check:ecosystem     # ecosystem classification rules
npm run check:search        # search index
npm run check:graph         # graph engine
npm run check:cargo         # Cargo manifest parsing
```

`npx tsx scripts/validate-content.ts` checks the published content itself
(broken URLs, stale reviews, duplicates) and is worth running before curation
sessions.

---

## Repository notes

- `AGENTS.md` (aliased by `CLAUDE.md`) carries instructions for AI coding
  agents. The installed Next.js differs from what models typically assume —
  verify APIs against `node_modules/next/dist/` rather than memory.
- `.open-next/` and `wrangler.jsonc` are leftovers from an abandoned
  OpenNext/Cloudflare Workers experiment. Neither `@opennextjs/cloudflare` nor
  `wrangler` is a dependency; ignore them unless deliberately reviving that
  path.
- The `*_REPORT.md`, `*_AUDIT.md` and `*_PLAN.md` files at the repo root are
  point-in-time working notes from past sessions. They are historical records,
  not live documentation — read them for context, don't trust their numbers.
