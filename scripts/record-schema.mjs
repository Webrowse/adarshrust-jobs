#!/usr/bin/env node
/**
 * Record the fingerprint of the schema that was just applied, into
 * schema_metadata. Runs automatically after `prisma db push` via `db:sync-schema`,
 * so the stored fingerprint always reflects the last intentional apply — no
 * manual version numbers.
 *
 * The normalise+hash logic is mirrored from lib/admin/schema-version.ts. Keep
 * the two identical so write-time and read-time fingerprints agree.
 */
import { readFileSync } from "fs"
import { createHash } from "crypto"
import { join } from "path"
import { execSync } from "child_process"
import { createRequire } from "module"

const require = createRequire(import.meta.url)
require("dotenv").config({ path: ".env.local" })
require("dotenv").config()

function normalizeSchema(text) {
  return text.replace(/\/\/.*$/gm, "").replace(/\s+/g, " ").trim()
}

const raw = readFileSync(join(process.cwd(), "prisma", "schema.prisma"), "utf8")
const fingerprint = createHash("sha256").update(normalizeSchema(raw)).digest("hex")

// GITHUB_SHA when this runs inside Actions, otherwise the local checkout.
let gitCommit = process.env.GITHUB_SHA ?? null
if (!gitCommit) {
  try { gitCommit = execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim() } catch { gitCommit = null }
}

const { PrismaClient } = await import("@prisma/client")
const { PrismaPg } = await import("@prisma/adapter-pg")
const connectionString = process.env.DATABASE_URL
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) })

await prisma.schemaMetadata.upsert({
  where: { id: "singleton" },
  create: { id: "singleton", fingerprint, gitCommit },
  update: { fingerprint, gitCommit },
})

console.log(`✓ schema recorded: ${fingerprint.slice(0, 16)}… @ ${gitCommit?.slice(0, 8) ?? "unknown"}`)
await prisma.$disconnect()
