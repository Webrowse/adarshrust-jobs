import { prisma } from "@/lib/prisma"
import { readContent } from "./storage"
import { listOverrides } from "./overrides"
import type { AdminRepoRow, RepoCuration, JobCuration, CompanyCuration } from "./curation-types"

/**
 * Curation data layer: the human judgment overlay on top of automated
 * intelligence. Raw pipeline output (content_items) is never mutated - every
 * human decision lives in its own Override row (kind "repo-curation" /
 * "job-curation" / "company-curation") keyed by the item's natural key, and is
 * merged at read time. Deleting an override restores pure machine output.
 *
 * Server-only (reads Prisma). Types, constants, and pure computations live in
 * ./curation-types so client components can share them.
 */

export * from "./curation-types"

// ── Curation maps (natural key -> override) ──────────────────────────────────

export async function getRepoCurationMap(): Promise<Record<string, RepoCuration>> {
  const rows = await listOverrides("repo-curation")
  return Object.fromEntries(rows.map((r) => [r.key, r.data as RepoCuration]))
}

export async function getJobCurationMap(): Promise<Record<string, JobCuration>> {
  const rows = await listOverrides("job-curation")
  return Object.fromEntries(rows.map((r) => [r.key, r.data as JobCuration]))
}

export async function getCompanyCurationMap(): Promise<Record<string, CompanyCuration>> {
  const rows = await listOverrides("company-curation")
  return Object.fromEntries(rows.map((r) => [r.key, r.data as CompanyCuration]))
}

// ── Admin repo rows: raw corpus + curation + computed quality signals ─────────

/**
 * What getAdminRepos actually needs per repo, projected out of the `data`
 * jsonb in SQL. The full rows carry multi-KB enrichment/relationships blobs
 * that the admin never renders; materialising all of them was a ~105 MB heap
 * transient on every authenticated admin view and is what OOM-crashed the
 * server at a 160 MB cap (502 on /admin, 2026-08-13). The projection keeps
 * the parse proportional to what the table shows.
 */
type ProjectedRepo = {
  owner: string
  name: string
  eco: string
  href: string
  note: string
  stars: number
  forks: number
  openIssues: number
  language: string | null
  license: string | null
  kind: string
  activityTier: string
  pushedAt: string | null
  ecosystems: unknown
  depCount: number
  confidence: number | null
  domain: string | null
  hasEnrichment: boolean
  hasClassification: boolean
  topicsCount: number
}

/**
 * The full corpus joined with curation, as the repo control screen consumes
 * it. Reads Postgres (source of truth). Rows are deliberately trimmed - the
 * client gets what the table renders, not the whole enrichment payload.
 */
export async function getAdminRepos(): Promise<AdminRepoRow[]> {
  const [rows, curationMap, companyOrgs] = await Promise.all([
    prisma.$queryRaw<ProjectedRepo[]>`
      SELECT
        data->>'owner'                                        AS owner,
        data->>'name'                                         AS name,
        COALESCE(data->>'eco', '')                            AS eco,
        COALESCE(data->>'href', '')                           AS href,
        COALESCE(data->>'note', '')                           AS note,
        COALESCE((data->>'stars')::int, 0)                    AS stars,
        COALESCE((data->>'forks')::int, 0)                    AS forks,
        COALESCE((data->>'openIssuesCount')::int, 0)          AS "openIssues",
        data->>'language'                                     AS language,
        data->>'license'                                      AS license,
        COALESCE(data->>'kind', 'code')                       AS kind,
        COALESCE(data->>'activityTier', 'dormant')            AS "activityTier",
        data->>'pushedAt'                                     AS "pushedAt",
        COALESCE(data->'ecosystemIntelligence'->'ecosystems',
                 data->'ecosystem', '[]'::jsonb)              AS ecosystems,
        COALESCE(jsonb_array_length(data->'dependencies'),
                 jsonb_array_length(data->'enrichment'->'cargo'->'dependencies'),
                 0)                                           AS "depCount",
        (data->'ecosystemIntelligence'->>'confidence')::float AS confidence,
        data->'ecosystemIntelligence'->>'domain'              AS domain,
        (data->'enrichment') IS NOT NULL                      AS "hasEnrichment",
        (data->'ecosystemIntelligence') IS NOT NULL           AS "hasClassification",
        COALESCE(jsonb_array_length(data->'topics'), 0)       AS "topicsCount"
      FROM content_items
      WHERE type = 'oss'
      ORDER BY "createdAt" ASC
    `,
    getRepoCurationMap(),
    getCompanyOrgs(),
  ])

  return rows.map((r) => {
    const slug = `${r.owner}/${r.name}`
    const missing: string[] = []
    if (!r.note.trim()) missing.push("description")
    if (!r.license) missing.push("license")
    if (r.topicsCount === 0) missing.push("topics")
    if (!r.hasEnrichment) missing.push("enrichment")
    if (!r.hasClassification) missing.push("classification")
    if (!r.pushedAt) missing.push("activity")
    const suspicious =
      r.stars >= 2000 &&
      (r.activityTier === "dormant" ||
        !r.license ||
        (r.confidence !== null && r.confidence < 0.3) ||
        !r.hasEnrichment)
    return {
      slug,
      name: r.name,
      owner: r.owner,
      eco: r.eco,
      href: r.href,
      note: r.note,
      stars: r.stars,
      forks: r.forks,
      openIssues: r.openIssues,
      language: r.language,
      license: r.license,
      kind: (r.kind === "reference" ? "reference" : "code") as AdminRepoRow["kind"],
      activityTier: (["active", "maintenance", "dormant"].includes(r.activityTier)
        ? r.activityTier
        : "dormant") as AdminRepoRow["activityTier"],
      pushedAt: r.pushedAt,
      ecosystems: Array.isArray(r.ecosystems) ? (r.ecosystems as string[]) : [],
      depCount: r.depCount,
      confidence: r.confidence,
      domain: r.domain,
      companyBacked: companyOrgs.has(r.owner.toLowerCase()),
      missing,
      suspicious,
      curation: curationMap[slug] ?? null,
    }
  })
}

/** GitHub orgs of tracked companies - marks repos as company-backed. */
async function getCompanyOrgs(): Promise<Set<string>> {
  const companies = await readContent("companies")
  const orgs = new Set<string>()
  for (const c of companies) {
    const org = (c as { github_org?: string }).github_org
    if (org) orgs.add(org.toLowerCase())
  }
  return orgs
}
