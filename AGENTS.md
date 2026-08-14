<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Verify any API against the installed version's type definitions under `node_modules/next/dist/` before writing code (the bundled `docs/` directory this used to point at is not present in this install). Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# OSSPath repo rules

## Architecture in one paragraph

Postgres is the source of truth; the public site never reads it. A publish (the admin's
Refresh / Republish, or the weekly GitHub refresh) exports the database as `content/*.json`
and commits it to this repo; that push runs `.github/workflows/deploy.yml`, which builds a
static export and ships `out/` to Cloudflare Pages. Nothing serves the public site but
files. Public pages are all static — `dynamicParams = false` on the big routes. The
pipeline is tiered (`lib/pipeline/orchestrator.ts`): Tier 1 scan/backfill → Tier 2 corpus
intelligence → Tier 3 export/publish, with 2 and 3 running only when Tier 1 changed the
corpus.

## Deployment facts

- **There is no production server.** `STATIC_EXPORT=1 npm run build` emits `out/`
  (~13.9k files, ~1.45 GB) and `wrangler pages deploy` uploads it to the `osspath`
  Cloudflare Pages project. Cloudflare Pages free tier caps a deployment at 20,000 files
  and 25 MiB per file — the export is comfortably under both, but a route that fans out
  per-corpus-row is what would eat the file budget.
- **The admin runs locally only** (`npm run dev` → `/admin`). It needs next-auth DB
  sessions and server actions, neither of which can be exported. See the pageExtensions
  trap below for how it is kept out of the production build.
- Database is **Neon** (free tier, Postgres 18, ~53 MB). Only the local admin and the two
  GitHub Actions crons connect. Neon scales to zero; cold starts are fine.
- Three workflows in `.github/workflows/`:
  - `deploy.yml` — push to main → static export → Pages. The only thing that publishes.
  - `refresh-github.yml` — Sundays 06:00 UTC. Refreshes stars/forks/open issues, and
    **publishes a snapshot commit when something changed**, which fires `deploy.yml`.
  - `backfill-batch.yml` — Wednesdays 06:00 UTC. Enrichment only, never publishes.
  - `ci.yml` — `tsc`, `check:purity` and the seven `check:*` suites on every push.
    `check-schema-sync` is deliberately absent there (needs `DATABASE_URL`); it runs in
    `deploy.yml`, which has the secret, so schema drift still blocks a deploy.
- Redirects and security headers live in `public/_redirects` and `public/_headers`.
  The `redirects()` / `headers()` blocks in `next.config.ts` cover `next dev` only and are
  inert under `output: export`.
- Crawler blocking is the **"Block SEO backlink crawlers" WAF custom rule** on the
  osspath.com zone (free tier, 1 of 5 custom rules). It mirrors the list in `app/robots.ts`
  and exempts `/robots.txt`. Search engines are not blocked.
- A crate gets a `/deps/[crate]` page at ≥ 25 dependent repos (`DEP_PAGE_THRESHOLD`,
  `lib/deps-data.ts`); the companion index only tracks crates in ≥ 6 repos.

## The traps that have actually cost time

**Public routes must never touch the database.** They read `content/*.json`. `npm run
check:purity` fails the build otherwise. The full 24 MB `content/oss.json` is off limits to
public routes too — they use the slim `oss-list.json` projection.

**The admin is excluded from the production build by filename, not by a config switch.**
`app/admin/**` and `app/api/auth/**` use `page.node.tsx` / `layout.node.tsx` /
`route.node.ts`, and `next.config.ts` puts `node.tsx`/`node.ts` in `pageExtensions` only
when `STATIC_EXPORT` is unset. In the export build those filenames match no page pattern,
so Next never sees a route there and never pulls prisma, next-auth or the server actions
into the graph. Renaming one of those files back to `page.tsx` will fail the export build
with a "missing generateStaticParams" or auth error, not with anything that names the
cause. Adding a new admin route means using the `.node.` suffix.

**Generated content files are gitignored on purpose.** `oss-companion-index.json`,
`oss-list.json`, `oss-qualified-crates.json`, `public/search-index.json`,
`public/oss-index.json`. Never commit one. A tracked companion index froze at an old
corpus and silently withheld 538 crate pages for two months; that is why the rule exists.

**`prebuild` order is load-bearing.** `build-companion-index.mjs` must run before
`build-search-index.mjs`, `build-oss-list.mjs` and `build-oss-index.mjs`, which read its
output. Verify changes with a clean-state run, not a warm tree:

```bash
rm -f content/oss-companion-index.json content/oss-list.json \
      content/oss-qualified-crates.json public/search-index.json public/oss-index.json
npm run prebuild
```

**`package-lock.json` is tracked and must be regenerated only from a clean slate**
(`rm -rf node_modules package-lock.json && npm install`). A lockfile assembled through
incremental install/uninstall steps on macOS shipped without `resolved`/`integrity`
fields and broke the Linux deploy on @tailwindcss/oxide native bindings (2026-08-13).

**Use Neon's direct endpoint, not the `-pooler` one.** The pipeline's raw SQL
(`lib/pipeline/refresh-github.ts`, `lib/admin/curation.ts`) names tables unqualified, so it
depends on `search_path`. Neon's pooler is PgBouncer in transaction mode, which leaks
session state between clients: restoring a `pg_dump` through it (pg_dump sets
`search_path = ''`) poisoned the pooled connections and made every unqualified query fail
with `relation "content_items" does not exist` (2026-08-15). Nothing here has the
short-lived-connection-burst shape the pooler exists for — it is the local admin plus one
cron at a time. `pg_advisory_xact_lock` in `lib/admin/pipeline-runs.ts` is
transaction-scoped and would survive either way.

**Never materialise the full corpus in runtime server code.** Parsing all ~5,600 rows
(from Postgres or `content/oss.json`) is a ~105 MB heap transient. Admin queries project
fields out of the `data` jsonb in SQL (see `getAdminRepos`). This mattered enormously when
a 256 MB-capped Railway server had to serve requests; the cap is gone with the server, but
the crons and the local admin still pay for it, and the publish path is the one legitimate
full materialisation.

**Schema changes deploy-block until pushed.** `check-schema-sync` fails the production
build on confirmed drift. Run `npm run db:sync-schema` before pushing any commit that
touches `prisma/schema.prisma`.

**`dynamicParams = false` means 404s are normal.** `/deps/[crate]`, `/oss/[owner]/[repo]`,
`/ecosystem/[slug]` and `/topics/[topic]` only serve params generated at build time; on
Pages an unknown slug gets the exported `404.html`. Before "fixing" a 404, check whether
the crate actually clears the 25-dependent threshold.

**Content updates are deploy-bound, and exactly one of them is automatic.** A snapshot
publish is a Git commit, and the site changes when `deploy.yml` finishes. The weekly
`refresh-github` job publishes itself when GitHub reported new numbers — that is the whole
automatic path. `backfill-batch` hardcodes `dirty: false` and never publishes, so whatever
enrichment it writes sits in Postgres until the next publish carries it out.

Because publishes land on `main` from outside your checkout, `git push` will be rejected
whenever one happened while you were working. Rebase onto it (`git pull --rebase origin
main`); a publish only ever touches `content/*.json`, so it will not conflict with code.

**Pages caches by deployment, so nothing needs purging.** Deploys are atomic and HTML is
served `max-age=0, must-revalidate` with an ETag; `/_next/static/*` is immutable via
`public/_headers`. The old zone cache rules that pinned HTML at the edge for a year existed
to keep traffic off the Railway origin and were deleted at cutover — re-adding one would
reintroduce stale HTML pointing at assets a later deployment no longer has.
