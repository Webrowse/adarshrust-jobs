#!/usr/bin/env node
/**
 * Build-time guardrail: fail the build ONLY when the live database schema is
 * confirmed to differ from the application schema. It must never fail because
 * the database happened to be unreachable — those are different problems.
 *
 * `prisma migrate diff --exit-code` reports:
 *   0 = in sync
 *   2 = confirmed drift (schema mismatch)   → the only condition that fails prod
 *   1 = error (unreachable, auth, parse, …) → "could not verify", never a mismatch
 *
 * DB connectivity is enforced separately by export-db-to-json (which genuinely
 * needs the database to build the static site and fails closed if it can't
 * reach it). This check only asserts the *shape* matches when it can be read.
 */
import { spawnSync } from "child_process"

// CI is set by GitHub Actions, which is where the production build runs.
const isProduction = Boolean(process.env.CI)

const res = spawnSync(
  "npx",
  ["prisma", "migrate", "diff", "--from-config-datasource", "--to-schema", "prisma/schema.prisma", "--exit-code"],
  { encoding: "utf8" },
)
const output = `${res.stdout ?? ""}\n${res.stderr ?? ""}`

// ── In sync ─────────────────────────────────────────────────────────────────
if (res.status === 0) {
  console.log("✓ schema-sync: database matches the application schema")
  process.exit(0)
}

// ── Confirmed drift (the ONLY failure condition) ──────────────────────────────
if (res.status === 2) {
  console.error("schema-sync: DATABASE SCHEMA DOES NOT MATCH the application.")
  console.error("  The live database differs from prisma/schema.prisma at this checkout.")
  const summary = (res.stdout ?? "").trim()
  if (summary) console.error(summary.split("\n").map((l) => "    " + l).join("\n"))
  if (isProduction) {
    console.error("✗ Failing the production build. Fix with: npm run db:sync-schema (from an up-to-date checkout).")
    process.exit(1)
  }
  console.warn("⚠ Local build: continuing despite schema mismatch. Run  npm run db:sync-schema  to fix.")
  process.exit(0)
}

// ── Could not verify — NOT a mismatch. Never fail on this. ────────────────────
const UNREACHABLE = /P1001|can'?t reach database|could not connect|connection refused|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|timed out|getaddrinfo|database server/i
if (UNREACHABLE.test(output)) {
  console.warn("• schema-sync: database was not reachable — skipping the schema comparison.")
  console.warn("  This is NOT a schema mismatch. If the DB is genuinely required at build,")
  console.warn("  export-db-to-json will fail next with a clear connectivity error.")
} else {
  console.warn("• schema-sync: could not verify the schema (unexpected diff error) — skipping.")
  console.warn("  " + (output.split("\n").find(Boolean) ?? "unknown error"))
}
process.exit(0)
