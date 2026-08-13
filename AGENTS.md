<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Verify any API against the installed version's type definitions under `node_modules/next/dist/` before writing code (the bundled `docs/` directory this used to point at is not present in this install). Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# OSSPath repo rules

## Architecture in one paragraph

Postgres is the source of truth; the public site never reads it. An admin action
(Refresh / Republish) exports the database as `content/*.json` and commits it to this
repo; the push triggers a Railway build that prerenders every page; Cloudflare caches
the result at the edge (honouring `s-maxage=31536000`). Public pages are all static —
`dynamicParams = false` on the big routes. The pipeline is tiered
(`lib/pipeline/orchestrator.ts`): Tier 1 scan/backfill → Tier 2 corpus intelligence →
Tier 3 export/publish, with 2 and 3 running only when Tier 1 changed the corpus.

## Deployment facts

- Railway project `distinguished-compassion`: `OssPath` (web), `Postgres`, and two weekly
  Tier-1-only crons (`osspath-backfill-batch`, `osspath-github-refresh`, each with its own
  `railway.*.toml`).
- Server heap capped at 256 MB old space (`railway.toml`); the build gets 4 GB. Railway
  bills average RSS per minute, so the average is the cost.
- The server exits cleanly at 04:30 UTC daily to reset memory drift
  (`instrumentation-node.ts`); `restartPolicyType = "ALWAYS"` restarts it. It defers while
  a pipeline run is active.
- On boot, the Cloudflare zone is purged **once per build**, gated by the Next build id
  recorded in the `edge_cache_marker` table — same-build restarts (including the nightly
  one) skip the purge. Needs `CLOUDFLARE_ZONE_ID` + `CLOUDFLARE_PURGE_TOKEN`; no-ops
  without them. Logs `[cache] purged…` or `[cache] skip purge…`.
- `middleware.ts` 403s SEO/backlink crawlers by User-Agent. Search engines are not blocked.
- A crate gets a `/deps/[crate]` page at ≥ 25 dependent repos (`DEP_PAGE_THRESHOLD`,
  `lib/deps-data.ts`); the companion index only tracks crates in ≥ 6 repos.
- CI (`.github/workflows/ci.yml`) runs `tsc`, `check:purity`, and the seven `check:*`
  suites on every push. `check-schema-sync` is excluded (needs `DATABASE_URL`).

## The traps that have actually cost time

**Public routes must never touch the database.** They read `content/*.json`. `npm run
check:purity` fails the build otherwise. The full 24 MB `content/oss.json` is off limits to
public routes too — they use the slim `oss-list.json` projection.

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

**Never materialise the full corpus in runtime server code.** Parsing all ~5,600 rows
(from Postgres or `content/oss.json`) is a ~105 MB heap transient; at the 256 MB heap cap
that is most of the headroom, and a 160 cap OOM-crashed /admin this way. Admin queries
project fields out of the `data` jsonb in SQL (see `getAdminRepos`). The publish path is
the one legitimate full materialisation, and the 256 cap exists to protect it.

**Schema changes deploy-block until pushed.** `check-schema-sync` fails the production
build on confirmed drift. Run `npm run db:sync-schema` before pushing any commit that
touches `prisma/schema.prisma`.

**`dynamicParams = false` means 404s are normal.** `/deps/[crate]`, `/oss/[owner]/[repo]`,
`/ecosystem/[slug]` and `/topics/[topic]` only serve params generated at build time.
`NoFallbackError` in the deploy logs is Next's internal signal for that path, logged at
error level, ~10–30/day. It is not an incident. Before "fixing" a 404, check whether the
crate actually clears the 25-dependent threshold.

**Content updates are manual and deploy-bound.** Nothing publishes itself. The weekly crons
run Tier 1 only and structurally cannot publish. A snapshot publish is a Git commit, and the
site changes when the resulting build ships.

**Memory is the hosting cost.** Railway bills average RSS per minute. Before adding
anything that inflates a response or holds state on the server, reread the memory bullets
under Deployment facts above — the 256 MB heap cap exists for this reason.
