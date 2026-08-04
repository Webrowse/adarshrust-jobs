import { createHash } from "crypto"
import type { ContentType } from "@/lib/admin/types"
import { CONTENT_TYPES } from "@/lib/admin/content-schema"
import { listOverrides } from "@/lib/admin/overrides"
import type { EcoTag } from "@/lib/eco-tags"
import { readPublished } from "./store"

/**
 * Deterministic snapshot of published content, materialised from PostgreSQL.
 *
 * PostgreSQL is the source of truth; this module projects it into the exact
 * bytes that get committed to Git (one content/<type>.json per type). The
 * output must be byte-stable for identical DB state, or the publish step would
 * create spurious commits. Determinism comes from two things:
 *   1. A stable row order - readPublished() orders by (createdAt, id).
 *   2. Canonical serialisation - object keys sorted recursively, no indentation,
 *      trailing newline. jsonb does not preserve key order, so we normalise it
 *      here.
 *
 * This is the single export implementation. It is imported by the pipeline
 * (server action) and by scripts/export-snapshot.ts (CLI). It reads the DB
 * lazily via the shared Prisma client; importing it opens no connection.
 */

export type SnapshotFile = { path: string; content: string }

/**
 * Content types included in the published snapshot, in fixed order (the
 * registry order from CONTENT_SCHEMA). This order is also the canonical order
 * used when a hash of the whole snapshot is computed downstream.
 */
export const SNAPSHOT_TYPES: ContentType[] = CONTENT_TYPES

/** Recursively sort object keys so serialisation is independent of key order. */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value !== null && typeof value === "object") {
    const source = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(source).sort()) out[key] = canonicalize(source[key])
    return out
  }
  return value
}

/**
 * Canonical JSON bytes for a value: sorted keys, no indentation, trailing
 * newline.
 *
 * Indentation was 2 spaces until it stopped being affordable: it accounted for
 * 41.4% of the full oss corpus file (40.2 MB pretty vs 23.5 MB minified), which
 * is uploaded on every publish and stored forever in Git history. These are
 * machine-generated artifacts that every consumer reads with JSON.parse, so the
 * whitespace bought readability in diffs nobody reads at that size. Use
 * `git show <rev>:content/<type>.json | jq` when a snapshot needs eyeballing.
 *
 * Canonicality is unaffected - key order and array order still make the output
 * a pure function of the data, which is what the no-op publish gate relies on.
 */
export function serialize(value: unknown): string {
  return JSON.stringify(canonicalize(value)) + "\n"
}

/**
 * SHA-256 over the snapshot's canonical bytes (path + content, in file order).
 * Used by the publish step to decide "did anything change?" by comparing the
 * generated snapshot to the one currently in Git - order matters and is fixed
 * by SNAPSHOT_TYPES, so equal content always yields an equal hash.
 */
export function snapshotSha256(files: SnapshotFile[]): string {
  const hash = createHash("sha256")
  for (const file of files) {
    hash.update(file.path)
    hash.update("\0")
    hash.update(file.content)
    hash.update("\0")
  }
  return hash.digest("hex")
}

/**
 * Overrides publish alongside content types, same lifecycle (Postgres -> Git
 * snapshot -> public site), same commit. They are configuration rather than
 * ContentItem-backed content (see lib/admin/overrides.ts), so they are
 * projected into their legacy file shapes here rather than via readPublished.
 * The pure projection is split out from the DB read so it's unit-testable
 * without a database (see scripts/check-override-snapshot.ts).
 */
type OverrideLike = { key: string; data: unknown }

export function buildEcoOverridesFile(rows: OverrideLike[]): SnapshotFile {
  const map: Record<string, EcoTag[]> = {}
  for (const r of rows) map[r.key] = r.data as EcoTag[]
  return { path: "content/eco-overrides.json", content: serialize(map) }
}

export function buildLifecycleEdgesFile(rows: OverrideLike[]): SnapshotFile {
  return { path: "content/lifecycle-edges.json", content: serialize(rows.map((r) => r.data)) }
}

/**
 * Human curation overlay (featured / hidden / score overrides / curator
 * notes), one map per domain keyed by natural key. Published beside the raw
 * content types, never merged into them: consumers opt in, and deleting an
 * override restores pure machine output. Queue review state and updatedAt are
 * admin bookkeeping and stay out of the public snapshot.
 */
export function buildCurationFile(
  repos: OverrideLike[], jobs: OverrideLike[], companies: OverrideLike[],
): SnapshotFile {
  const publicView = (rows: OverrideLike[]) => {
    const map: Record<string, unknown> = {}
    for (const r of rows) {
      const rest = { ...((r.data ?? {}) as Record<string, unknown>) }
      delete rest.queue
      delete rest.updatedAt
      if (Object.keys(rest).length > 0) map[r.key] = rest
    }
    return map
  }
  return {
    path: "content/curation.json",
    content: serialize({ repos: publicView(repos), jobs: publicView(jobs), companies: publicView(companies) }),
  }
}

async function exportEcoOverrides(): Promise<SnapshotFile> {
  return buildEcoOverridesFile(await listOverrides("eco-tags"))
}

async function exportLifecycleEdges(): Promise<SnapshotFile> {
  return buildLifecycleEdgesFile(await listOverrides("lifecycle-edges"))
}

async function exportCuration(): Promise<SnapshotFile> {
  const [repos, jobs, companies] = await Promise.all([
    listOverrides("repo-curation"),
    listOverrides("job-curation"),
    listOverrides("company-curation"),
  ])
  return buildCurationFile(repos, jobs, companies)
}

/**
 * Build the full snapshot in memory from current PostgreSQL state. Fail-closed:
 * all types are read before returning, so a read failure throws and the caller
 * writes/commits nothing. Never returns a partial snapshot.
 */
export async function exportSnapshot(): Promise<SnapshotFile[]> {
  const files: SnapshotFile[] = []
  for (const type of SNAPSHOT_TYPES) {
    const items = await readPublished(type)
    files.push({ path: `content/${type}.json`, content: serialize(items) })
  }
  files.push(await exportEcoOverrides())
  files.push(await exportLifecycleEdges())
  files.push(await exportCuration())
  return files
}
