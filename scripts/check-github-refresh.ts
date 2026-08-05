/**
 * Guard for the GitHub refresh selection gate and merge (lib/pipeline/refresh-github).
 * Pure functions, no DB and no network. Run: tsx scripts/check-github-refresh.ts
 */
import {
  needsGithubRefresh, repoPathFromHref, computeActivityTier, applyGithubData, hasRefreshChange,
  GITHUB_REFRESH_MAX_AGE_DAYS as MAX_AGE,
} from "@/lib/pipeline/refresh-github"

let failed = 0
function assert(label: string, cond: boolean) { if (!cond) { console.error(`x ${label}`); failed++ } }

const now = Date.parse("2026-08-05T00:00:00Z")
const daysAgo = (d: number) => new Date(now - d * 86_400_000).toISOString().slice(0, 10)

// ── Selection gate ───────────────────────────────────────────────────────────
assert("never checked -> refresh", needsGithubRefresh({}, now) === true)
assert("empty watermark -> refresh", needsGithubRefresh({ githubCheckedAt: "" }, now) === true)
assert("garbage watermark -> refresh", needsGithubRefresh({ githubCheckedAt: "not-a-date" }, now) === true)
assert("non-string watermark -> refresh", needsGithubRefresh({ githubCheckedAt: 12345 }, now) === true)
assert("checked today -> skip", needsGithubRefresh({ githubCheckedAt: daysAgo(0) }, now) === false)
assert("checked 1d ago -> skip", needsGithubRefresh({ githubCheckedAt: daysAgo(1) }, now) === false)
assert(`checked ${MAX_AGE}d ago -> refresh`, needsGithubRefresh({ githubCheckedAt: daysAgo(MAX_AGE) }, now) === true)
assert("checked 30d ago -> refresh", needsGithubRefresh({ githubCheckedAt: daysAgo(30) }, now) === true)

// ── href parsing ─────────────────────────────────────────────────────────────
assert("plain repo url", repoPathFromHref("https://github.com/tokio-rs/axum") === "tokio-rs/axum")
assert("trailing path ignored", repoPathFromHref("https://github.com/tokio-rs/axum/tree/main") === "tokio-rs/axum")
assert("query ignored", repoPathFromHref("https://github.com/tokio-rs/axum?tab=readme") === "tokio-rs/axum")
assert("owner-only -> null", repoPathFromHref("https://github.com/tokio-rs") === null)
assert("non-github -> null", repoPathFromHref("https://gitlab.com/a/b") === null)
assert("empty -> null", repoPathFromHref("") === null)

// ── Activity tier ────────────────────────────────────────────────────────────
assert("no pushedAt -> dormant", computeActivityTier(null) === "dormant")
assert("pushed today -> active", computeActivityTier(new Date().toISOString()) === "active")
assert("pushed 60d -> maintenance", computeActivityTier(new Date(Date.now() - 60 * 86_400_000).toISOString()) === "maintenance")
assert("pushed 200d -> dormant", computeActivityTier(new Date(Date.now() - 200 * 86_400_000).toISOString()) === "dormant")

// ── Merge preserves existing values when GitHub omits a field ────────────────
const before: Record<string, unknown> = { href: "https://github.com/a/b", stars: 10, forks: 2, openIssuesCount: 1, language: "Rust", license: "MIT", pushedAt: "2026-01-01T00:00:00Z", activityTier: "dormant" }
const merged = applyGithubData(before, { stargazers_count: 99 }, "2026-08-05")
assert("stars updated", merged.stars === 99)
assert("forks preserved when absent", merged.forks === 2)
assert("language preserved when absent", merged.language === "Rust")
assert("license preserved when absent", merged.license === "MIT")
assert("pushedAt preserved when absent", merged.pushedAt === "2026-01-01T00:00:00Z")
assert("watermark stamped", merged.githubCheckedAt === "2026-08-05")

// GitHub explicitly clearing a license comes through as null, not a preserved stale value.
const cleared = applyGithubData(before, { stargazers_count: 10, license: { spdx_id: null } }, "2026-08-05")
assert("explicit null license falls back", cleared.license === "MIT")

// ── Dirty detection: the watermark alone must never make a run dirty ─────────
const sameData = applyGithubData(before, { stargazers_count: 10, forks_count: 2, open_issues_count: 1, language: "Rust", license: { spdx_id: "MIT" }, pushed_at: "2026-01-01T00:00:00Z" }, "2026-08-05")
assert("identical fields -> not dirty", hasRefreshChange(before, sameData) === false)
assert("watermark differs but fields same -> not dirty", sameData.githubCheckedAt !== before.githubCheckedAt && hasRefreshChange(before, sameData) === false)
assert("star change -> dirty", hasRefreshChange(before, merged) === true)

if (failed > 0) {
  console.error(`\n✗ ${failed} github-refresh assertion(s) failed`)
  process.exit(1)
}
console.log("✓ github-refresh: selection gate, href parsing, tier, merge, and dirty detection all correct")
