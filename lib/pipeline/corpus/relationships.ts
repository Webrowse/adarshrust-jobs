import { prisma } from "@/lib/prisma"
import type { CorpusProcessor } from "./index"
import { computeSimilarity, type SimilarEntry } from "./similarity"
import { buildCompanionIndex, companionsForRepo, type Companion } from "./companions"
import { bulkUpdateData } from "./bulk-write"

/**
 * Tier 2 processor: repository relationships and ecosystem knowledge.
 *
 * Reads the `dependencies` field Tier 1 already writes to every OSS repo (no
 * Tier 1 change needed), computes corpus-wide similarity and companion-crate
 * co-occurrence, and writes the per-repo result back to `data.relationships`.
 * PostgreSQL stays the only source of truth - this only enriches existing rows
 * further, the same way Tier 1's `data.enrichment` does.
 *
 * Versioned like Tier 1 enrichment, so a future algorithm change can force
 * recomputation. A row is only written when its relationships actually
 * changed (ignoring the volatile `computedAt` stamp), so an unchanged corpus
 * produces zero writes and no spurious downstream Git diff.
 */

export const RELATIONSHIPS_VERSION = 1

export type Relationships = {
  version: number
  computedAt: string
  similar: SimilarEntry[]
  companions: Companion[]
}

function sameRelationships(a: unknown, b: Relationships): boolean {
  const prev = a as Relationships | undefined
  if (!prev || prev.version !== b.version) return false
  return JSON.stringify(prev.similar) === JSON.stringify(b.similar)
    && JSON.stringify(prev.companions) === JSON.stringify(b.companions)
}

type Row = { id: string; slug: string; dependencies: string[]; data: Record<string, unknown> }

function toRow(id: string, data: Record<string, unknown>): Row | null {
  const owner = typeof data.owner === "string" ? data.owner : ""
  const name = typeof data.name === "string" ? data.name : ""
  if (!owner || !name) return null
  const dependencies = Array.isArray(data.dependencies)
    ? data.dependencies.filter((d): d is string => typeof d === "string")
    : []
  return { id, slug: `${owner}/${name}`, dependencies, data }
}

export const relationshipsProcessor: CorpusProcessor = {
  name: "relationships",

  async run() {
    const rows = await prisma.contentItem.findMany({ where: { type: "oss" } })
    const parsed = rows
      .map((r) => toRow(r.id, r.data as Record<string, unknown>))
      .filter((r): r is Row => r !== null)

    const similarity = computeSimilarity(parsed.map((r) => ({ slug: r.slug, dependencies: r.dependencies })))
    const companionIndex = buildCompanionIndex(parsed.map((r) => ({ slug: r.slug, dependencies: r.dependencies })))

    const computedAt = new Date().toISOString()
    const pending: { id: string; data: Record<string, unknown> }[] = []
    for (const row of parsed) {
      const next: Relationships = {
        version: RELATIONSHIPS_VERSION,
        computedAt,
        similar: similarity.get(row.slug) ?? [],
        companions: companionsForRepo(row.dependencies, companionIndex),
      }
      if (sameRelationships(row.data.relationships, next)) continue
      pending.push({ id: row.id, data: { ...row.data, relationships: next } })
    }
    const updated = await bulkUpdateData(pending)

    return { notes: [`${updated} / ${parsed.length} repo(s) updated (similarity + companion crates)`] }
  },
}
