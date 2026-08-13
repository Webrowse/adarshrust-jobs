/**
 * Content validation script.
 * Run: npx tsx scripts/validate-content.ts
 *
 * Checks for:
 * - Missing required fields
 * - Invalid URL formats
 * - Items past their review interval (stale)
 * - Items expiring within 14 days (warn)
 * - Duplicate entries
 */

import { readFileSync } from "fs"
import { join } from "path"
import { JOBS } from "../content/jobs"
import type { OSSPath } from "../content/oss-paths"
import { GRANTS } from "../content/grants"
import { PULSE } from "../content/pulse"
import { EVENTS } from "../content/events"
import { COMPANIES } from "../content/companies"
import { REVIEW_INTERVALS, type ContentType } from "../lib/content-utils"

const OSS_PATHS: OSSPath[] = JSON.parse(
  readFileSync(join(__dirname, "../content/oss.json"), "utf-8")
)

// ── Helpers ───────────────────────────────────────────────────────────────────

const WARN_EXPIRY_DAYS = 14
let errors = 0
let warnings = 0

function err(ctx: string, msg: string) {
  console.error(`  ✗ [${ctx}] ${msg}`)
  errors++
}

function warn(ctx: string, msg: string) {
  console.warn(`  ⚠ [${ctx}] ${msg}`)
  warnings++
}

function checkUrl(ctx: string, url: string) {
  try {
    const u = new URL(url)
    if (!["http:", "https:", "mailto:"].includes(u.protocol)) {
      err(ctx, `URL has unexpected protocol: ${url}`)
    }
  } catch {
    err(ctx, `Invalid URL: ${url}`)
  }
}

function checkDate(ctx: string, field: string, value?: string) {
  if (!value) {
    err(ctx, `Missing required field: ${field}`)
    return
  }
  const d = new Date(value)
  if (isNaN(d.getTime())) {
    err(ctx, `Invalid date for ${field}: ${value}`)
    return
  }
  if (field === "checkedAt") {
    const now = new Date()
    const localToday = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`
    if (value > localToday) err(ctx, `checkedAt is in the future: ${value}`)
  }
}

function checkStale(ctx: string, type: ContentType, checkedAt?: string) {
  if (!checkedAt) return
  const days = Math.floor((Date.now() - new Date(checkedAt).getTime()) / 86400000)
  const interval = REVIEW_INTERVALS[type]
  if (days > interval) {
    warn(ctx, `Stale — last checked ${days}d ago (review interval: ${interval}d)`)
  }
}

function checkExpiringSoon(ctx: string, expiresAt?: string) {
  if (!expiresAt) return
  const daysLeft = Math.floor((new Date(expiresAt).getTime() - Date.now()) / 86400000)
  if (daysLeft < 0) {
    err(ctx, `Already expired: ${expiresAt}`)
  } else if (daysLeft <= WARN_EXPIRY_DAYS) {
    warn(ctx, `Expires in ${daysLeft}d (${expiresAt})`)
  }
}

// ── Validate jobs ─────────────────────────────────────────────────────────────

console.log("\nJobs:")
const jobKeys = new Set<string>()
for (const job of JOBS) {
  const ctx = `${job.company} — ${job.role}`
  if (!job.company) err(ctx, "Missing company")
  if (!job.role)    err(ctx, "Missing role")
  checkUrl(ctx, job.href)
  checkDate(ctx, "checkedAt", job.checkedAt)
  checkDate(ctx, "expiresAt", job.expiresAt)
  checkStale(ctx, "jobs", job.checkedAt)
  checkExpiringSoon(ctx, job.expiresAt)
  const key = `${job.company}::${job.role}`
  if (jobKeys.has(key)) err(ctx, "Duplicate entry")
  jobKeys.add(key)
}
if (errors === 0 && warnings === 0) console.log("  All jobs OK")

// ── Validate OSS paths ────────────────────────────────────────────────────────

console.log("\nOSS Paths:")
const ossKeys = new Set<string>()
// The corpus is thousands of machine-refreshed repos: one stale line per repo
// drowned every real error (4,600+ warnings at one point), so staleness is
// reported as a single distribution summary instead.
let ossStale = 0
let ossOldest = 0
for (const repo of OSS_PATHS) {
  const ctx = repo.name
  if (!repo.name) err(ctx, "Missing name")
  checkUrl(ctx, repo.href)
  checkDate(ctx, "checkedAt", repo.checkedAt)
  if (repo.checkedAt) {
    const days = Math.floor((Date.now() - new Date(repo.checkedAt).getTime()) / 86400000)
    if (days > REVIEW_INTERVALS.oss) {
      ossStale++
      if (days > ossOldest) ossOldest = days
    }
  }
  const ossKey = repo.href || repo.name
  if (ossKeys.has(ossKey)) err(ctx, "Duplicate entry")
  ossKeys.add(ossKey)
}
if (ossStale > 0) {
  warn(
    "oss corpus",
    `${ossStale} of ${OSS_PATHS.length} repos past the ${REVIEW_INTERVALS.oss}d review interval (oldest ${ossOldest}d)`,
  )
}
if (errors === 0 && warnings === 0) console.log("  All OSS paths OK")

// ── Validate grants ───────────────────────────────────────────────────────────

console.log("\nGrants:")
const grantKeys = new Set<string>()
for (const grant of GRANTS) {
  const ctx = grant.name
  checkUrl(ctx, grant.href)
  checkDate(ctx, "checkedAt", grant.checkedAt)
  checkStale(ctx, "grants", grant.checkedAt)
  checkExpiringSoon(ctx, grant.expiresAt)
  if (grantKeys.has(grant.name)) err(ctx, "Duplicate entry")
  grantKeys.add(grant.name)
}
if (errors === 0 && warnings === 0) console.log("  All grants OK")

// ── Validate pulse ────────────────────────────────────────────────────────────

console.log("\nPulse:")
const pulseTitles = new Set<string>()
const pulseHrefs = new Set<string>()
for (const item of PULSE) {
  const ctx = item.title
  checkUrl(ctx, item.href)
  checkDate(ctx, "checkedAt", item.checkedAt)
  checkStale(ctx, "pulse", item.checkedAt)
  if (pulseTitles.has(item.title)) err(ctx, "Duplicate title")
  if (pulseHrefs.has(item.href)) err(ctx, "Duplicate href — same URL as another entry")
  pulseTitles.add(item.title)
  pulseHrefs.add(item.href)
}
if (errors === 0 && warnings === 0) console.log("  All pulse items OK")

// ── Validate events ───────────────────────────────────────────────────────────

console.log("\nEvents:")
const eventKeys = new Set<string>()
for (const event of EVENTS) {
  const ctx = event.title
  checkUrl(ctx, event.href)
  checkDate(ctx, "checkedAt", event.checkedAt)
  checkStale(ctx, "events", event.checkedAt)
  checkExpiringSoon(ctx, event.expiresAt)
  if (eventKeys.has(event.title)) err(ctx, "Duplicate entry")
  eventKeys.add(event.title)
}
if (errors === 0 && warnings === 0) console.log("  All events OK")

// ── Validate companies ────────────────────────────────────────────────────────

console.log("\nCompanies:")
const companyKeys = new Set<string>()
for (const company of COMPANIES) {
  const ctx = company.name
  checkUrl(ctx, company.href)
  if (companyKeys.has(company.name)) err(ctx, "Duplicate entry")
  companyKeys.add(company.name)
}
if (errors === 0 && warnings === 0) console.log("  All companies OK")

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(50)}`)
console.log(`Errors:   ${errors}`)
console.log(`Warnings: ${warnings}`)
console.log(errors > 0 ? "\nFailed." : warnings > 0 ? "\nPassed with warnings." : "\nAll content valid.")

process.exit(errors > 0 ? 1 : 0)
