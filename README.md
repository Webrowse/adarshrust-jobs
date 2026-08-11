# OSSPath

A curated map of the Rust ecosystem — jobs, repositories, crates, funding, organizations,
and community signals. Live at **[osspath.com](https://osspath.com)**.

The site is deliberately small and human-reviewed. Nothing is scraped into it
automatically; every entry is verified before it appears. See [CONTRIBUTING.md](CONTRIBUTING.md)
for the inclusion rules.

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

## Architecture

Postgres is the source of truth. The public site never talks to it.

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

Three consequences worth internalising:

1. **Content changes require a deploy.** A snapshot publish is a Git commit; the site only
   changes once the resulting build ships. There is no runtime database read on public
   pages.
2. **Public routes read `content/*.json`, never Prisma.** `scripts/check-public-purity.mjs`
   enforces this at build time and fails the build if a public route imports the DB or
   loads the full corpus.
3. **Everything public is statically prerendered.** The large dynamic routes set
   `dynamicParams = false`, so a URL that wasn't generated at build time 404s rather than
   rendering on demand. That is intentional — it bounds what the server can be asked to do.

### The pipeline tiers

`lib/pipeline/orchestrator.ts` owns the sequencing: **Tier 1** (scan / backfill, supplied by
the caller) → **Tier 2** (corpus intelligence) → **Tier 3** (exports and publish). Tiers 2
and 3 run only if Tier 1 reports the corpus `dirty`. Entry points must call the
orchestrator rather than re-implementing the sequence.

This is why a no-op Refresh correctly publishes nothing — and why forcing current Postgres
state to Git needs the **Republish** action instead.

---

## Build

`npm run build` is preceded by a `prebuild` chain, and **the order matters**:

```
check-public-purity   → no DB imports or full-corpus loads in public routes
check-schema-sync     → database matches the Prisma schema
build-companion-index → content/oss-companion-index.json   (from content/oss.json)
build-search-index    → public/search-index.json           ┐ both read the
build-oss-list        → content/oss-list.json              ┘ companion index
                        content/oss-qualified-crates.json
```

`build-companion-index.mjs` must stay ahead of the other two. If you reorder it, a
clean-state build (`rm content/oss-list.json content/oss-qualified-crates.json
content/oss-companion-index.json && npm run prebuild`) fails with ENOENT — a warm working
tree will hide the mistake.

**Generated files are not tracked.** `oss-companion-index.json`, `oss-list.json`,
`oss-qualified-crates.json` and `public/search-index.json` are gitignored and rebuilt every
deploy from the tracked `content/oss.json`. Tracking a derived file has bitten this repo
before: the companion index was committed and never regenerated, froze at a ~2,100-repo
corpus, and silently withheld 538 crate pages until 2026-08-10.

### Which crates get a page

A crate needs **≥ 25 dependent repositories** (`DEP_PAGE_THRESHOLD` in `lib/deps-data.ts`)
to get a `/deps/[crate]` page. The count comes from the companion index, which itself only
tracks crates appearing in ≥ 6 repos (`MIN_REPOS` in `scripts/build-companion-index.mjs`).
Keep the two in sync with the sitemap's `depUrls()`.

As of 2026-08-11: 5,394 repos, 1,039 crate pages, 6,627 sitemap URLs.

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

**Server memory is deliberately capped.** `railway.toml` starts the server with
`NODE_OPTIONS=--max-old-space-size=256`, overriding the 4096 MB service variable that the
*build* needs. Note this caps V8's old space, not the process: the resulting heap ceiling is
~448 MB and steady-state RSS is ~0.45–0.50 GB. Railway bills memory per minute, so average
RSS is the cost driver.

### Edge caching

osspath.com is proxied through Cloudflare. Two cache rules: one bypasses `/admin`, `/api`
and authenticated sessions; the other makes public pages cacheable and **honours the
origin's `cache-control`** (`s-maxage=31536000`), with serve-stale-while-revalidating on.

Because pages can then sit at the edge indefinitely, `instrumentation.ts` **purges the zone
once on server boot** — the moment the new build is actually live. It needs two variables on
the `OssPath` service, and no-ops without them:

```
CLOUDFLARE_ZONE_ID      the osspath.com zone id
CLOUDFLARE_PURGE_TOKEN  custom token: Zone · Cache Purge · Purge, scoped to osspath.com
```

Confirm it worked by looking for `[cache] purged Cloudflare edge cache on boot` in the
deploy logs; a bad token logs `[cache] purge rejected:` instead.

### Crawler control

`middleware.ts` returns 403 to SEO/backlink crawlers by User-Agent (Ahrefs, Semrush, MJ12,
DotBot, SE Ranking and others). They send no referral traffic but sweep the whole corpus on
a loop, and `/oss` is a ~6 MB response. `app/robots.ts` asks the same crawlers to stay away;
the middleware enforces it, because robots.txt is advisory. Search engines and AI search
crawlers are deliberately **not** blocked.

---

## Local development

```bash
npm install
npx prisma generate
npm run dev            # http://localhost:3000
```

Requires a `.env.local` with at least `DATABASE_URL`, `AUTH_SECRET`, `NEXTAUTH_URL`, and
`ADMIN_EMAIL`; OAuth sign-in additionally needs `GITHUB_ID`/`GITHUB_SECRET` or
`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`. Publishing from a local admin session needs
`GITHUB_PUBLISH_TOKEN`, `PUBLISH_REPO` and `PUBLISH_BRANCH`.

The public site renders from the committed `content/*.json`, so most UI work needs no
database at all.

### Scripts

Most of these you never run by hand. Sorted by whether you actually need them.

**Runs automatically — don't run these yourself.** `check:purity` and `check-schema-sync`
execute on every build via `prebuild`, and fail the build if violated. `db:backfill-batch`
and `db:refresh-github` are the start commands for the two weekly Railway cron services.

**Run when you change the schema:**

```bash
npm run db:sync-schema      # prisma db push + record schema
```

Nothing else pushes schema changes to production, so this is the one command with no
automation behind it.

**Test suite — optional, run when touching that subsystem.** There is **no CI**, so nothing
runs these unless you do. All seven pass as of 2026-08-11.

```bash
npm run check:corpus        # corpus relationship integrity
npm run check:snapshot      # snapshot determinism
npm run check:orchestrator  # tier sequencing
npm run check:ecosystem     # ecosystem classification rules
npm run check:search        # search index
npm run check:graph         # graph engine
npm run check:cargo         # Cargo manifest parsing
```

They're worth running before a risky change to the pipeline, and worth wiring into GitHub
Actions if this ever stops being a solo project. `db:export` is a CLI alternative to the
admin panel's publish action and is effectively unused.

---

## Repository notes

- `AGENTS.md` (aliased by `CLAUDE.md`) carries instructions for AI coding agents. The
  installed Next.js differs from what models typically assume — verify APIs against
  `node_modules/next/dist/` rather than memory.
- `.open-next/` and `wrangler.jsonc` are leftovers from an abandoned OpenNext/Cloudflare
  Workers experiment. Neither `@opennextjs/cloudflare` nor `wrangler` is a dependency;
  ignore them unless deliberately reviving that path.
- The many `*_REPORT.md`, `*_AUDIT.md` and `*_PLAN.md` files at the repo root are
  point-in-time working notes from past sessions. They are historical records, not live
  documentation — read them for context, don't trust their numbers.
