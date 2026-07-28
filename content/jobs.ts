import rawJobs from "./jobs.json"
import type { EcoTag } from "@/lib/eco-tags"

export type EditorialJob = {
  slug:           string
  company:        string
  company_slug:   string
  role:           string
  href:           string
  note:           string
  tags:           string[]
  topics:         string[]
  ecosystems:     EcoTag[]
  rustMentioned:  boolean
  remoteConfirmed: boolean
  description?:   string
  checkedAt:      string
  expiresAt:      string
}

// Runtime guard: a failed extraction can publish a job row with no role/company
// and a placeholder "job" slug. Those render as blank cards and previously broke
// the search index, so drop them here — the single choke point every consumer uses.
export const JOBS = (rawJobs as unknown as EditorialJob[]).filter(
  j => Boolean(j?.slug) && j.slug !== "job" && Boolean(j?.role) && Boolean(j?.company)
)
