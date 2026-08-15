import { prisma } from "@/lib/prisma"
import type { CorpusProcessor } from "./index"
import { inferEcosystem, type EcosystemResult } from "./ecosystem-rules"
import { bulkUpdateData } from "./bulk-write"

/**
 * Tier 2 processor: Ecosystem Intelligence.
 *
 * Per-repo, not cross-repo - each repo's ecosystem/technology/domain is
 * inferred purely from that repo's own Tier 1 Cargo enrichment (categories,
 * keywords, dependencies). It registers in the same CORPUS_PROCESSORS array as
 * the cross-repo relationships processor, proving Tier 2's registry does not
 * require every processor to compute over the whole corpus at once - only to
 * consume the enriched corpus and produce knowledge.
 *
 * Skips repos Tier 1 has not enriched yet (data.enrichment absent) - nothing
 * to infer from. A repo Tier 1 enriched but found no manifest for still gets a
 * real "no signal" result (confidence 0), which is itself accurate knowledge.
 * Idempotent: a row is written only when its computed result actually changed.
 */

export const ECOSYSTEM_VERSION = 1

export type EcosystemIntelligence = EcosystemResult & {
  version: number
  computedAt: string
}

function sameEcosystem(prevRaw: unknown, next: EcosystemIntelligence): boolean {
  const prev = prevRaw as EcosystemIntelligence | undefined
  if (!prev || prev.version !== next.version) return false
  return prev.domain === next.domain
    && prev.confidence === next.confidence
    && JSON.stringify(prev.ecosystems) === JSON.stringify(next.ecosystems)
    && JSON.stringify(prev.technologies) === JSON.stringify(next.technologies)
    && JSON.stringify(prev.reasoning) === JSON.stringify(next.reasoning)
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []
}

export const ecosystemProcessor: CorpusProcessor = {
  name: "ecosystem",

  async run() {
    const rows = await prisma.contentItem.findMany({ where: { type: "oss" } })
    const computedAt = new Date().toISOString()
    const pending: { id: string; data: Record<string, unknown> }[] = []
    let notYetEnriched = 0

    for (const row of rows) {
      const data = row.data as Record<string, unknown>
      const enrichment = data.enrichment as { cargo?: Record<string, unknown> } | undefined
      const cargo = enrichment?.cargo
      if (!cargo) { notYetEnriched++; continue }

      const result = inferEcosystem({
        categories: asStringArray(cargo.categories),
        keywords: asStringArray(cargo.keywords),
        dependencies: asStringArray(cargo.dependencies),
        devDependencies: asStringArray(cargo.devDependencies),
        buildDependencies: asStringArray(cargo.buildDependencies),
      })

      const next: EcosystemIntelligence = { version: ECOSYSTEM_VERSION, computedAt, ...result }
      if (sameEcosystem(data.ecosystemIntelligence, next)) continue

      pending.push({ id: row.id, data: { ...data, ecosystemIntelligence: next } })
    }
    const updated = await bulkUpdateData(pending)

    return { notes: [`${updated} / ${rows.length} repo(s) updated (${notYetEnriched} not yet Tier 1-enriched, skipped)`] }
  },
}
