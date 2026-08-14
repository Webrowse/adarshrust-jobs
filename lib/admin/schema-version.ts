import { readFileSync } from "fs"
import { createHash } from "crypto"
import { join } from "path"
import { execSync } from "child_process"
import { prisma } from "@/lib/prisma"

/**
 * Schema drift guardrail. Fingerprints prisma/schema.prisma (normalised so
 * formatting and comments don't matter) and compares the running app's
 * fingerprint to the one stored in schema_metadata when the schema was last
 * applied. A mismatch means the database was applied from a different (likely
 * stale) checkout — the failure mode that dropped the pipeline tables.
 *
 * NOTE: the normalise+hash logic here is mirrored in scripts/record-schema.mjs.
 * Keep the two identical so the write-time and read-time fingerprints agree.
 */

/** Strip comments and collapse whitespace so only real schema tokens matter. */
export function normalizeSchema(text: string): string {
  return text.replace(/\/\/.*$/gm, "").replace(/\s+/g, " ").trim()
}

/** SHA-256 of the normalised prisma/schema.prisma. */
export function computeSchemaFingerprint(): string {
  const raw = readFileSync(join(process.cwd(), "prisma", "schema.prisma"), "utf8")
  return createHash("sha256").update(normalizeSchema(raw)).digest("hex")
}

/** The checkout's git commit. The admin only ever runs locally, so this is it. */
export function currentGitCommit(): string | null {
  try {
    return execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim()
  } catch {
    return null
  }
}

export type SchemaStatus = {
  match: boolean
  appFingerprint: string
  dbFingerprint: string | null
  currentCommit: string | null
  dbCommit: string | null
  updatedAt: Date | null
  error?: string
}

/** Compare the app's schema fingerprint to the one stored in the database. */
export async function getSchemaStatus(): Promise<SchemaStatus> {
  const appFingerprint = computeSchemaFingerprint()
  const currentCommit = currentGitCommit()
  try {
    const row = await prisma.schemaMetadata.findUnique({ where: { id: "singleton" } })
    return {
      match: row?.fingerprint === appFingerprint,
      appFingerprint,
      dbFingerprint: row?.fingerprint ?? null,
      currentCommit,
      dbCommit: row?.gitCommit ?? null,
      updatedAt: row?.updatedAt ?? null,
    }
  } catch (e) {
    // schema_metadata missing (or DB unreachable) => cannot confirm => treat as mismatch.
    return {
      match: false,
      appFingerprint,
      dbFingerprint: null,
      currentCommit,
      dbCommit: null,
      updatedAt: null,
      error: String(e).split("\n")[0],
    }
  }
}
