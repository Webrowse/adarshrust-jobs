import { prisma } from "@/lib/prisma"
import type { ContentType } from "./types"

/**
 * Managed scanner sources. Each row tells the pipeline what to scan, how often,
 * and carries the incremental watermark (fingerprint + lastRunAt) so unchanged
 * sources can be skipped. Replaces the hardcoded scanner constants for
 * scheduling and enable/disable control.
 */

// Scanner implementations the pipeline can dispatch to.
export type SourceKind =
  | "hn"
  | "twir"
  | "github-oss"
  | "github-pulse"
  | "github-orgs"
  | "events"
  | "portals"
  | "rust-bytes"
  | "careers"
  | "reddit"
  | "remoteok"
  | "weworkremotely"
  | "rustler-in"

export type SourceRow = {
  id: string
  type: ContentType
  kind: SourceKind
  label: string
  url: string | null
  parser: string | null
  enabled: boolean
  intervalHours: number
  fingerprint: string | null
  lastRunAt: Date | null
  config: Record<string, unknown> | null
}

export type SourceInput = {
  type: ContentType
  kind: SourceKind
  label: string
  url?: string | null
  parser?: string | null
  enabled?: boolean
  intervalHours?: number
  config?: Record<string, unknown> | null
}

function toRow(r: {
  id: string; type: string; kind: string; label: string; url: string | null;
  parser: string | null; enabled: boolean; intervalHours: number;
  fingerprint: string | null; lastRunAt: Date | null; config: unknown;
}): SourceRow {
  return {
    id: r.id,
    type: r.type as ContentType,
    kind: r.kind as SourceKind,
    label: r.label,
    url: r.url,
    parser: r.parser,
    enabled: r.enabled,
    intervalHours: r.intervalHours,
    fingerprint: r.fingerprint,
    lastRunAt: r.lastRunAt,
    config: (r.config as Record<string, unknown> | null) ?? null,
  }
}

export async function listSources(type?: ContentType): Promise<SourceRow[]> {
  const rows = await prisma.source.findMany({
    where: type ? { type } : undefined,
    orderBy: [{ enabled: "desc" }, { type: "asc" }, { label: "asc" }],
  })
  return rows.map(toRow)
}

export async function enabledSources(): Promise<SourceRow[]> {
  const rows = await prisma.source.findMany({ where: { enabled: true } })
  return rows.map(toRow)
}

/** Sources that are enabled and past their refresh interval (or never run). */
export async function dueSources(now: Date = new Date()): Promise<SourceRow[]> {
  const rows = await prisma.source.findMany({ where: { enabled: true } })
  return rows.map(toRow).filter((s) => {
    if (!s.lastRunAt) return true
    const nextDue = s.lastRunAt.getTime() + s.intervalHours * 3_600_000
    return now.getTime() >= nextDue
  })
}

export async function getSource(id: string): Promise<SourceRow | null> {
  const r = await prisma.source.findUnique({ where: { id } })
  return r ? toRow(r) : null
}

export async function createSource(input: SourceInput): Promise<SourceRow> {
  const r = await prisma.source.create({
    data: {
      type: input.type,
      kind: input.kind,
      label: input.label,
      url: input.url ?? null,
      parser: input.parser ?? null,
      enabled: input.enabled ?? true,
      intervalHours: input.intervalHours ?? 24,
      config: (input.config ?? undefined) as never,
    },
  })
  return toRow(r)
}

export async function updateSource(id: string, patch: Partial<SourceInput>): Promise<void> {
  await prisma.source.update({
    where: { id },
    data: {
      ...(patch.type !== undefined ? { type: patch.type } : {}),
      ...(patch.kind !== undefined ? { kind: patch.kind } : {}),
      ...(patch.label !== undefined ? { label: patch.label } : {}),
      ...(patch.url !== undefined ? { url: patch.url } : {}),
      ...(patch.parser !== undefined ? { parser: patch.parser } : {}),
      ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
      ...(patch.intervalHours !== undefined ? { intervalHours: patch.intervalHours } : {}),
      ...(patch.config !== undefined ? { config: (patch.config ?? undefined) as never } : {}),
    },
  })
}

export async function deleteSource(id: string): Promise<void> {
  await prisma.source.delete({ where: { id } })
}

/** Record that a source was scanned: bumps lastRunAt and optionally the watermark. */
export async function markSourceRun(id: string, fingerprint?: string | null): Promise<void> {
  await prisma.source.update({
    where: { id },
    data: {
      lastRunAt: new Date(),
      ...(fingerprint !== undefined ? { fingerprint } : {}),
    },
  })
}
