#!/usr/bin/env node
/**
 * INV-1 guard: the public render path must never import PostgreSQL or auth.
 *
 * The public website is fully static and must generate zero database queries
 * for visitors. PostgreSQL is reachable only from the Refresh pipeline and the
 * build-time export. This guard fails the build if any route under app/
 * (except app/admin/** and app/api/auth/**) imports @/lib/prisma, @/lib/auth,
 * or anything under @/lib/admin.
 *
 * INV-2 guard: the public render path must never load the full OSS corpus.
 *
 * content/oss.json is ~35MB with per-repo relationships/enrichment blobs that
 * only the single-repo detail page needs. Every other public route reads the
 * slim build-time projection (content/oss-list.json) via lib/oss-data.ts.
 * This guard fails the build if any file outside lib/oss-detail-data.ts and
 * app/oss/[owner]/[repo]/** imports @/lib/oss-detail-data or references
 * content/oss.json directly — so the production server can never end up
 * holding the full corpus in memory to serve a route that doesn't need it.
 *
 * Run: node scripts/check-public-purity.mjs
 */
import { readdirSync, readFileSync, statSync } from "fs"
import { join, relative } from "path"

const ROOT = process.cwd()

function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full)
  }
  return out
}

const violations = []

// ── INV-1: DB/auth stays out of the public render path ────────────────────────

const DB_AUTH_ALLOWED_PREFIXES = [
  join("app", "admin"),
  join("app", "api", "auth"),
  // Admin-only client components legitimately import @/lib/admin server actions.
  join("components", "admin"),
]
const DB_AUTH_FORBIDDEN = /from\s+["']@\/lib\/(prisma|auth|admin(?:\/[^"']+)?)["']/

// components/ is walked too: a public page importing a component that imports
// the DB would otherwise slip past a guard that only looks at app/.
for (const dir of ["app", "components"]) {
  for (const file of walk(join(ROOT, dir))) {
    const rel = relative(ROOT, file)
    if (DB_AUTH_ALLOWED_PREFIXES.some((p) => rel.startsWith(p))) continue

    const src = readFileSync(file, "utf-8")
    const m = src.match(DB_AUTH_FORBIDDEN)
    if (m) violations.push(`${rel}: imports ${m[0].replace(/from\s+/, "")} (DB/auth must stay under app/admin, app/api/auth, or components/admin)`)
  }
}

// ── INV-2: the full OSS corpus stays out of every route but the detail page ──

const CORPUS_ALLOWED_PREFIXES = [join("app", "oss", "[owner]", "[repo]")]
const CORPUS_ALLOWED_FILES = [join("lib", "oss-detail-data.ts")]
const CORPUS_FORBIDDEN_IMPORT = /from\s+["']@\/lib\/oss-detail-data["']/
const CORPUS_FORBIDDEN_LITERAL = /content\/oss\.json/

for (const dir of ["app", "lib", "components"]) {
  for (const file of walk(join(ROOT, dir))) {
    const rel = relative(ROOT, file)
    if (CORPUS_ALLOWED_PREFIXES.some((p) => rel.startsWith(p))) continue
    if (CORPUS_ALLOWED_FILES.includes(rel)) continue

    const src = readFileSync(file, "utf-8")
    if (CORPUS_FORBIDDEN_IMPORT.test(src)) {
      violations.push(`${rel}: imports @/lib/oss-detail-data (only app/oss/[owner]/[repo] may load the full corpus)`)
    } else if (CORPUS_FORBIDDEN_LITERAL.test(src)) {
      violations.push(`${rel}: references content/oss.json directly (read it via lib/oss-data.ts's slim projection instead)`)
    }
  }
}

if (violations.length > 0) {
  console.error("✗ public-purity violations found:")
  for (const v of violations) console.error(`    ${v}`)
  process.exit(1)
}

console.log("✓ public-purity: no DB/auth imports and no full-corpus loads outside the detail page")
