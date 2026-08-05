import type { Collector } from "./types"
import type { SourceKind, SourceRow } from "@/lib/admin/sources"
import { dueSources } from "@/lib/admin/sources"
import { collectHN } from "./scan/hn"
import { collectTWIR } from "./scan/twir"
import { collectGitHubOSS } from "./scan/github-oss"
import { collectPulse } from "./scan/pulse"
import { collectCompanies } from "./scan/companies"
import { collectEvents } from "./scan/events"
import { collectPortals } from "./scan/portals"
import { collectRustBytes } from "./scan/rust-bytes"
import { collectCareers } from "./scan/careers"
import { collectReddit } from "./scan/reddit"
import { collectRemoteOK } from "./scan/remoteok"
import { collectWeWorkRemotely } from "./scan/weworkremotely"
import { collectRustlerIn } from "./scan/rustler"

/** Maps each managed source kind to its pure scanner core. */
export const KIND_TO_COLLECTOR: Record<SourceKind, Collector> = {
  "hn": collectHN,
  "twir": collectTWIR,
  "github-oss": collectGitHubOSS,
  "github-pulse": collectPulse,
  "github-orgs": collectCompanies,
  "events": collectEvents,
  "portals": collectPortals,
  "rust-bytes": collectRustBytes,
  "careers": collectCareers,
  "reddit": collectReddit,
  "remoteok": collectRemoteOK,
  "weworkremotely": collectWeWorkRemotely,
  "rustler-in": collectRustlerIn,
}

export type ScanJob = { source: SourceRow; collect: Collector }

/**
 * What this run will scan, plus the due sources it could not route.
 *
 * `unroutable` exists because a source's `kind` comes out of Postgres as a bare
 * string and toRow() casts it to SourceKind unchecked, so a row can carry a kind
 * that no collector implements. That happened silently: a "grants" source sat
 * enabled and permanently due from 2026-07-02 onward, skipped on every run with
 * nothing reported, while the admin listed it as healthy. Returning these
 * instead of dropping them lets the caller surface the misconfiguration.
 */
export type ScanPlan = { jobs: ScanJob[]; unroutable: SourceRow[] }

/**
 * The scan plan for this run: enabled sources past their refresh interval,
 * each paired with its collector. Honouring intervals means a daily Refresh only
 * scans sources that are actually due, so cost tracks the refresh cadence, not
 * dataset size.
 */
export async function dueScanJobs(now: Date = new Date()): Promise<ScanPlan> {
  const due = await dueSources(now)
  const jobs: ScanJob[] = []
  const unroutable: SourceRow[] = []
  for (const source of due) {
    const collect = KIND_TO_COLLECTOR[source.kind] as Collector | undefined
    if (collect) jobs.push({ source, collect })
    else unroutable.push(source)
  }
  return { jobs, unroutable }
}
