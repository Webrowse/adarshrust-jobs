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
`oss-list.json`, `oss-qualified-crates.json`, `public/search-index.json`. Never commit one.
A tracked companion index froze at an old corpus and silently withheld 538 crate pages for
two months; that is why the rule exists.

**`prebuild` order is load-bearing.** `build-companion-index.mjs` must run before both
`build-search-index.mjs` and `build-oss-list.mjs`, which read its output. Verify changes
with a clean-state run, not a warm tree:

```bash
rm -f content/oss-companion-index.json content/oss-list.json content/oss-qualified-crates.json
npm run prebuild
```

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
