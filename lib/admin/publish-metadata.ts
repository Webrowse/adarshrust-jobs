import { prisma } from "@/lib/prisma"

/**
 * Persistence for the last successful content publish to Git.
 *
 * PostgreSQL is the source of truth; Git is a derived snapshot. This single row
 * records which Git commit currently reflects the published content, a SHA-256
 * of that canonical content, and when it was published - so the admin can see
 * what is live. It is written only after a push succeeds (see the pipeline,
 * later commit); nothing here decides whether to publish.
 */

export type PublishMetadata = {
  lastCommitSha: string | null
  lastContentSha256: string | null
  lastPublishedAt: Date | null
  updatedAt: Date | null
}

/** Read the singleton, or null if nothing has ever been published. */
export async function getPublishMetadata(): Promise<PublishMetadata | null> {
  const row = await prisma.publishMetadata.findUnique({ where: { id: "singleton" } })
  if (!row) return null
  return {
    lastCommitSha: row.lastCommitSha,
    lastContentSha256: row.lastContentSha256,
    lastPublishedAt: row.lastPublishedAt,
    updatedAt: row.updatedAt,
  }
}

/**
 * Whether Postgres holds writes newer than the last published snapshot — the
 * "I changed something but never clicked Republish" drift that has shipped
 * before. Checks both write surfaces: content_items (pipeline) and overrides
 * (human curation). Coarse on purpose: any newer write flags it, even one a
 * publish would no-op on; a false "ahead" costs one no-op Republish.
 */
export async function hasUnpublishedWrites(): Promise<boolean | null> {
  const meta = await getPublishMetadata()
  if (!meta?.lastPublishedAt) return null
  const [item, override] = await Promise.all([
    prisma.contentItem.aggregate({ _max: { updatedAt: true } }),
    prisma.override.aggregate({ _max: { updatedAt: true } }),
  ])
  const newest = Math.max(
    item._max.updatedAt?.getTime() ?? 0,
    override._max.updatedAt?.getTime() ?? 0,
  )
  return newest > meta.lastPublishedAt.getTime()
}

/** Record a successful publish. Upserts the singleton; stamps lastPublishedAt now. */
export async function recordPublish(input: { commitSha: string; contentSha256: string }): Promise<void> {
  const now = new Date()
  await prisma.publishMetadata.upsert({
    where: { id: "singleton" },
    create: {
      id: "singleton",
      lastCommitSha: input.commitSha,
      lastContentSha256: input.contentSha256,
      lastPublishedAt: now,
    },
    update: {
      lastCommitSha: input.commitSha,
      lastContentSha256: input.contentSha256,
      lastPublishedAt: now,
    },
  })
}
