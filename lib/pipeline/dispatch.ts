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
 * The scan jobs for this run: enabled sources that are past their refresh
 * interval, paired with their collector. Sources whose kind has no collector
 * are skipped. Honouring intervals means a daily Refresh only scans sources
 * that are actually due, so cost tracks the refresh cadence, not dataset size.
 */
export async function dueScanJobs(now: Date = new Date()): Promise<ScanJob[]> {
  const due = await dueSources(now)
  const jobs: ScanJob[] = []
  for (const source of due) {
    const collect = KIND_TO_COLLECTOR[source.kind] as Collector | undefined
    if (collect) jobs.push({ source, collect })
  }
  return jobs
}
