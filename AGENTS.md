<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Verify any API against the installed version's type definitions under `node_modules/next/dist/` before writing code (the bundled `docs/` directory this used to point at is not present in this install). Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# OSSPath repo rules

Read [README.md](README.md) for the architecture. The traps below are the ones that have
actually cost time.

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

**Memory is the hosting cost.** Railway bills average RSS per minute. Before adding anything
that inflates a response or holds state on the server, check `README.md` § Deployment — the
server heap is capped at 256 MB old space for this reason.
