import Link from "next/link"
import { getActiveRun, getLatestRun, type RunRow } from "@/lib/admin/pipeline-runs"
import { getSchemaStatus } from "@/lib/admin/schema-version"
import { getPublishMetadata, type PublishMetadata } from "@/lib/admin/publish-metadata"
import { getAdminRepos, computeCorpusHealth, computeQuality, buildQueues, QUEUE_META, QUEUE_IDS } from "@/lib/admin/curation"
import { RefreshPanel } from "@/components/admin/refresh-panel"
import { SchemaStatusPanel } from "@/components/admin/schema-status"
import { isAdmin } from "@/lib/admin/require-admin"

function fmt(d: Date | string | null | undefined): string {
  if (!d) return "never"
  return new Date(d).toISOString().slice(0, 16).replace("T", " ") + "Z"
}

function pct(n: number | null): string {
  return n === null ? "–" : `${Math.round(n * 100)}%`
}

export default async function AdminPage() {
  if (!(await isAdmin())) return null
  let active: RunRow | null = null
  let latest: RunRow | null = null
  let publish: PublishMetadata | null = null
  let corpus = null
  let quality = null
  let queueCounts: Array<{ id: string; label: string; count: number }> = []
  let dbDown = false

  try {
    ;[active, latest] = await Promise.all([getActiveRun(), getLatestRun()])
  } catch {
    // DB unreachable - panel still renders and Refresh will surface the error.
  }
  try {
    publish = await getPublishMetadata()
  } catch {
    // publish_metadata not applied yet (merge-time db:sync-schema); show "never published".
  }
  try {
    const repos = await getAdminRepos()
    corpus = computeCorpusHealth(repos)
    quality = computeQuality(repos)
    const queues = buildQueues(repos)
    queueCounts = QUEUE_IDS.map((id) => ({ id, label: QUEUE_META[id].label, count: queues[id].length }))
  } catch {
    dbDown = true
  }

  const schema = await getSchemaStatus()
  const report = latest?.report
  const discovered = report ? Object.values(report.added ?? {}).reduce((a, b) => a + (b ?? 0), 0) : 0

  return (
    <>
      <div className="adm-page-header">
        <span className="adm-page-title">Control Center</span>
        <span className="adm-page-meta">automation discovers · humans curate</span>
      </div>

      <div className="adm-content" style={{ paddingBottom: 0 }}>
        <SchemaStatusPanel status={schema} />

        {dbDown ? (
          <div className="adm-db-warn" style={{ margin: "0 0 12px" }}>
            Database unreachable — corpus and quality stats unavailable.
          </div>
        ) : corpus && quality && (
          <div className="adm-ov">
            <section className="adm-ov__group">
              <h2 className="adm-ov__title">Corpus health</h2>
              <div className="adm-ov__grid">
                <Link href="/admin/repos" className="adm-stat">
                  <span className="adm-stat__n">{corpus.total.toLocaleString()}</span>
                  <span className="adm-stat__label">repos</span>
                </Link>
                <Link href="/admin/repos?activity=active" className="adm-stat">
                  <span className="adm-stat__n adm-stat__n--ok">{corpus.active.toLocaleString()}</span>
                  <span className="adm-stat__label">active</span>
                </Link>
                <Link href="/admin/repos?activity=stale" className="adm-stat">
                  <span className="adm-stat__n adm-stat__n--dim">{corpus.stale.toLocaleString()}</span>
                  <span className="adm-stat__label">stale</span>
                </Link>
                <Link href="/admin/repos?state=hidden" className="adm-stat">
                  <span className="adm-stat__n adm-stat__n--warn">{corpus.hidden.toLocaleString()}</span>
                  <span className="adm-stat__label">hidden</span>
                </Link>
                <Link href="/admin/repos?state=featured" className="adm-stat">
                  <span className="adm-stat__n adm-stat__n--accent">{corpus.featured.toLocaleString()}</span>
                  <span className="adm-stat__label">featured</span>
                </Link>
              </div>
            </section>

            <section className="adm-ov__group">
              <h2 className="adm-ov__title">Pipeline</h2>
              <div className="adm-ov__grid">
                <div className="adm-stat">
                  <span className="adm-stat__n adm-stat__n--mono">{fmt(latest?.finishedAt ?? latest?.startedAt)}</span>
                  <span className="adm-stat__label">
                    last run {active ? "· running now" : latest ? `· ${latest.status}` : ""}
                  </span>
                </div>
                <div className="adm-stat">
                  <span className="adm-stat__n adm-stat__n--mono">{fmt(publish?.lastPublishedAt)}</span>
                  <span className="adm-stat__label">
                    last Git snapshot{publish?.lastCommitSha ? ` · ${publish.lastCommitSha.slice(0, 7)}` : ""}
                  </span>
                </div>
                <Link href="/admin/reports" className="adm-stat">
                  <span className={`adm-stat__n${(report?.errors?.length ?? 0) > 0 ? " adm-stat__n--warn" : " adm-stat__n--ok"}`}>
                    {report?.errors?.length ?? 0}
                  </span>
                  <span className="adm-stat__label">failures (last run)</span>
                </Link>
                <Link href="/admin/reports" className="adm-stat">
                  <span className="adm-stat__n">{discovered}</span>
                  <span className="adm-stat__label">new discoveries</span>
                </Link>
              </div>
            </section>

            <section className="adm-ov__group">
              <h2 className="adm-ov__title">Quality</h2>
              <div className="adm-ov__grid">
                <Link href="/admin/queue?tab=popular-suspicious" className="adm-stat">
                  <span className={`adm-stat__n${quality.suspicious > 0 ? " adm-stat__n--warn" : ""}`}>{quality.suspicious}</span>
                  <span className="adm-stat__label">suspicious repos</span>
                </Link>
                <Link href="/admin/repos?flag=missing" className="adm-stat">
                  <span className="adm-stat__n">{quality.missingMetadata.toLocaleString()}</span>
                  <span className="adm-stat__label">missing metadata</span>
                </Link>
                <Link href="/admin/queue?tab=needs-review" className="adm-stat">
                  <span className="adm-stat__n">{quality.lowConfidence.toLocaleString()}</span>
                  <span className="adm-stat__label">low confidence</span>
                </Link>
                <div className="adm-stat">
                  <span className="adm-stat__n">{pct(quality.avgConfidence)}</span>
                  <span className="adm-stat__label">avg classification confidence</span>
                </div>
              </div>
            </section>

            <section className="adm-ov__group">
              <h2 className="adm-ov__title">Curation queues</h2>
              <div className="adm-ov__grid">
                {queueCounts.map((q) => (
                  <Link key={q.id} href={`/admin/queue?tab=${q.id}`} className="adm-stat">
                    <span className={`adm-stat__n${q.count > 0 ? " adm-stat__n--accent" : " adm-stat__n--dim"}`}>{q.count}</span>
                    <span className="adm-stat__label">{q.label.toLowerCase()}</span>
                  </Link>
                ))}
              </div>
            </section>
          </div>
        )}
      </div>

      <RefreshPanel initialActive={active} initialLatest={latest} initialPublish={publish} />
    </>
  )
}
