#!/usr/bin/env node
/**
 * Seed the sources table from the current scanner set.
 *
 * One row per scanner, carrying its content type, refresh interval, and (later)
 * incremental watermark. Idempotent: a scanner kind that already exists is left
 * untouched, so re-running never duplicates or overwrites live watermarks.
 *
 * Fine-grained sources (individual GitHub queries, orgs, companies) stay inside
 * the scanners for now and will be extracted to rows in a later stage.
 *
 * Run: node scripts/seed-sources.mjs
 */
import { createRequire } from "module"

const require = createRequire(import.meta.url)
require("dotenv").config({ path: ".env.local" })
require("dotenv").config()

const { PrismaClient } = await import("@prisma/client")
const { PrismaPg } = await import("@prisma/adapter-pg")
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
})

// label, kind, type (content type it primarily feeds), url, intervalHours
const SEED = [
  ["HN Who's Hiring",        "hn",           "jobs",      "https://hn.algolia.com/api/v1/search_by_date", 24],
  ["This Week in Rust",      "twir",         "news",      "https://this-week-in-rust.org",                24],
  ["GitHub OSS",             "github-oss",   "oss",       null,                                           24],
  ["GitHub Pulse",           "github-pulse", "pulse",     null,                                          168],
  ["GitHub Orgs (companies)","github-orgs",  "companies", null,                                          168],
  ["Rust Foundation Grants", "grants",       "grants",    "https://foundation.rust-lang.org/grants/",    168],
  ["Rust Events",            "events",       "events",    null,                                           24],
  ["Job Portals",            "portals",      "portals",   null,                                          720],
  ["Rust Bytes",             "rust-bytes",   "oss",       "https://rust.libhunt.com/newsletter",         168],
  ["Company Careers",        "careers",      "jobs",      null,                                           24],
  ["r/rust",                 "reddit",       "news",      "https://www.reddit.com/r/rust",                24],
  ["RemoteOK",               "remoteok",     "jobs",      "https://remoteok.com/api",                     24],
  ["We Work Remotely",       "weworkremotely","jobs",     "https://weworkremotely.com/categories/remote-programming-jobs.rss", 24],
  ["rustler.in",             "rustler-in",   "jobs",      "https://rustler.in/sitemap.xml",               24],
]

let created = 0
let skipped = 0
for (const [label, kind, type, url, intervalHours] of SEED) {
  const existing = await prisma.source.findFirst({ where: { kind } })
  if (existing) {
    skipped++
    console.log(`  · ${kind} already present, skipped`)
    continue
  }
  await prisma.source.create({
    data: { label, kind, type, url, intervalHours, enabled: true },
  })
  created++
  console.log(`  ✓ ${kind} (${type}) → "${label}"`)
}

console.log(`\n✓ Sources seeded: ${created} created, ${skipped} skipped`)
await prisma.$disconnect()
