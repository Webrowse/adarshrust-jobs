import { notFound } from "next/navigation"
import Link from "next/link"
import type { Metadata } from "next"
import { EditorialLayout } from "@/components/editorial/editorial-layout"
import { GrantCard } from "@/components/editorial/grant-card"
import { OSSCard } from "@/components/editorial/oss-card"
import { JOBS } from "@/content/jobs"
import { getJobBySlug } from "@/lib/jobs-data"
import { getCompanyBySlug, buildCompanyProfile } from "@/lib/company-data"
import { getProgramsForEcosystem } from "@/lib/grants-data"
import { getDepPageCounts } from "@/lib/deps-data"
import { ECO_LABEL } from "@/lib/eco-tags"
import type { EcoTag } from "@/lib/eco-tags"
import type { FundingProgram } from "@/content/grants"
import { formatCheckedAt } from "@/lib/content-utils"
import { CorrectionLink } from "@/components/editorial/correction-link"
import { matchPathForJob } from "@/lib/career-paths"
import { ECO_DISPLAY_NAME } from "@/lib/eco-tags"

export const dynamicParams = false

interface PageProps {
  params: Promise<{ slug: string }>
}

export function generateStaticParams(): { slug: string }[] {
  return JOBS.map(j => ({ slug: j.slug }))
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params
  const job = getJobBySlug(slug)
  if (!job) return { title: "Not Found" }

  const title = `${job.role} at ${job.company}`
  const description = job.note

  return {
    title,
    description,
    alternates: { canonical: `/jobs/${slug}` },
    openGraph: {
      title,
      description,
      url: `/jobs/${slug}`,
      type: "website",
      images: [{ url: "/opengraph-image", width: 1200, height: 630 }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: ["/opengraph-image"],
    },
  }
}

function dedupPrograms(programs: FundingProgram[]): FundingProgram[] {
  const seen = new Set<string>()
  return programs.filter(p => {
    if (seen.has(p.slug)) return false
    seen.add(p.slug)
    return true
  })
}

export default async function JobDetailPage({ params }: PageProps) {
  const { slug } = await params
  const job      = getJobBySlug(slug)
  if (!job) notFound()

  const company = getCompanyBySlug(job.company_slug)
  const profile = company ? buildCompanyProfile(company) : null
  const orgTopRepos = profile?.repos.slice(0, 4) ?? []
  const depCounts = getDepPageCounts()

  // Collect funding programs from all job ecosystems, deduplicate, cap at 4
  const relatedPrograms = dedupPrograms(
    (job.ecosystems ?? []).flatMap(eco => getProgramsForEcosystem(eco as EcoTag))
  ).slice(0, 4)

  const isRemote  = job.remoteConfirmed || job.tags.some(t => t.toLowerCase() === "remote")
  const locations = job.tags.filter(t => !["remote", "full-time", "full time", "onsite"].includes(t.toLowerCase()))

  // Career route: which destination this job maps to, and the skill legs it implies
  const pathMatch = matchPathForJob(job)
  const requirementChips: string[] = [
    ...(job.rustMentioned ? ["Rust"] : []),
    ...(job.topics ?? []),
    ...(job.ecosystems ?? []).map(e => ECO_DISPLAY_NAME[e]),
  ]

  // JobPosting structured data: jobs are the one content type where rich
  // results (Google Jobs) drive real traffic. Fields map from curated data;
  // optional ones are omitted rather than invented.
  const jobLd = {
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: job.role,
    description: job.note,
    datePosted: job.checkedAt,
    ...(job.expiresAt ? { validThrough: job.expiresAt } : {}),
    ...(isRemote ? { jobLocationType: "TELECOMMUTE" } : {}),
    ...(job.tags.some(t => t.toLowerCase().startsWith("full")) ? { employmentType: "FULL_TIME" } : {}),
    hiringOrganization: {
      "@type": "Organization",
      name: job.company,
      ...(company?.href ? { sameAs: company.href } : {}),
    },
    directApply: true,
    url: `https://osspath.com/jobs/${job.slug}`,
  }

  return (
    <EditorialLayout>
      <script
        type="application/ld+json"
        // "<" escaped so curated text can never close the script tag early.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jobLd).replace(/</g, "\\u003c") }}
      />
      <section style={{ paddingTop: "clamp(40px, 6vw, 64px)", paddingBottom: "clamp(64px, 9vw, 104px)" }}>
        <div className="e-col">

          {/* Breadcrumb */}
          <nav aria-label="Breadcrumb" style={{ marginBottom: 24, display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
            <Link href="/jobs" style={{ fontSize: 13, color: "var(--e-fg-mute)", textDecoration: "none" }}>
              ← Jobs
            </Link>
            {company && (
              <Link href={`/ecosystem/${company.slug}`} style={{ fontSize: 13, color: "var(--e-fg-mute)", textDecoration: "none" }}>
                {company.name}
              </Link>
            )}
          </nav>

          {/* Header */}
          <header style={{ marginBottom: 32 }}>
            <div className="e-section__num">{job.company}</div>
            <h1
              className="e-section__title"
              style={{ fontSize: "clamp(20px, 2.8vw, 30px)", fontFamily: "var(--font-ibm-plex-mono)" }}
            >
              {job.role}
            </h1>
            <p className="e-archive-meta" style={{ marginTop: 12, maxWidth: 640 }}>
              {job.note}
            </p>
          </header>

          {/* Tags strip */}
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 8,
              marginBottom: 32,
              paddingBottom: 24,
              borderBottom: "1px solid var(--e-line-soft)",
            }}
          >
            {isRemote && (
              <span className="e-tag e-tag--accent">Remote</span>
            )}
            {locations.slice(0, 3).map(t => (
              <span key={t} className="e-tag">{t}</span>
            ))}
            {job.rustMentioned && (
              <span className="e-tag e-tag--soft" style={{ fontFamily: "var(--e-mono)", fontSize: 12 }}>Rust mentioned</span>
            )}
          </div>

          {/* Ecosystems */}
          {job.ecosystems && job.ecosystems.length > 0 && (
            <div style={{ marginBottom: 36 }}>
              <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--e-fg-dim)", marginBottom: 12 }}>
                Ecosystems
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {job.ecosystems.map(tag => (
                  <Link
                    key={tag}
                    href={`/ecosystems/${tag}`}
                    className={`e-oss__eco-badge e-oss__eco-badge--${tag} e-oss__eco-badge--lg`}
                    style={{ textDecoration: "none" }}
                  >
                    {ECO_LABEL[tag]}
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Company card */}
          {company && (
            <div
              style={{
                marginBottom: 40,
                padding: "16px 20px",
                border: "1px solid var(--e-line-soft)",
                borderRadius: 6,
              }}
            >
              <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--e-fg-dim)", marginBottom: 8 }}>
                Company
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 600, color: "var(--e-fg)", fontFamily: "var(--e-mono)", marginBottom: 4 }}>
                    {company.name}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--e-fg-dim)", marginBottom: 8 }}>
                    {company.sector}
                  </div>
                  {company.description && (
                    <p style={{ fontSize: 13, color: "var(--e-fg-dim)", margin: 0, lineHeight: 1.5, maxWidth: 520 }}>
                      {company.description}
                    </p>
                  )}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
                  <Link
                    href={`/ecosystem/${company.slug}`}
                    style={{ fontSize: 13, color: "var(--e-accent)", textDecoration: "none", fontFamily: "var(--e-mono)", whiteSpace: "nowrap" }}
                  >
                    Company profile →
                  </Link>
                  <a
                    href={company.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ fontSize: 13, color: "var(--e-fg-mute)", textDecoration: "none", whiteSpace: "nowrap" }}
                  >
                    Website →
                  </a>
                </div>
              </div>
            </div>
          )}

          {/* Apply CTA */}
          <div style={{ marginBottom: 48 }}>
            <a href={job.href} target="_blank" rel="noopener noreferrer" className="e-btn">
              Apply at {job.company} →
            </a>
            <p style={{ fontSize: 12, color: "var(--e-fg-faint)", marginTop: 8 }}>
              {formatCheckedAt(job.checkedAt) ?? `Last reviewed ${job.checkedAt}`}
            </p>
          </div>

          {/* ── Path to this job ─────────────────────────────────────────── */}
          {pathMatch && (
            <div style={{ marginBottom: 48 }}>
              <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--e-fg-dim)", marginBottom: 6 }}>
                How to become the person who gets this job
              </div>
              <p style={{ fontSize: 13, color: "var(--e-fg-dim)", margin: "0 0 16px", lineHeight: 1.6, maxWidth: "64ch" }}>
                This listing maps to the <b style={{ color: "var(--e-fg)" }}>{pathMatch.path.title}</b> route
                {pathMatch.signals.length > 0 && <> — {pathMatch.signals.join(", ")}</>}.
              </p>

              {/* Requirements detected */}
              {requirementChips.length > 0 && (
                <div style={{ marginBottom: 20 }}>
                  <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--e-fg-dim)", marginBottom: 8 }}>
                    Signals in the listing
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {requirementChips.slice(0, 10).map(c => (
                      <span key={c} className="e-tag e-tag--soft" style={{ fontSize: 12 }}>✓ {c}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* Skill map */}
              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
                {(["required", "recommended", "bonus"] as const).map(level => {
                  const capabilities = pathMatch.path.capabilities.filter(c => c.level === level)
                  if (capabilities.length === 0) return null
                  const label = level === "bonus" ? "Sets you apart" : level === "required" ? "You'll need" : "Strongly helps"
                  return (
                    <div key={level} style={{ display: "grid", gridTemplateColumns: "110px 1fr", gap: 12, alignItems: "baseline" }}>
                      <span style={{ fontFamily: "var(--e-mono)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", color: level === "required" ? "var(--e-accent)" : "var(--e-fg-dim)" }}>
                        {label}
                      </span>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        {capabilities.map(cap => (
                          <Link
                            key={cap.id}
                            href={`/paths/${pathMatch.path.slug}#leg-${cap.id}`}
                            style={{ textDecoration: "none" }}
                          >
                            <span className="e-tag e-tag--soft" style={{ cursor: "pointer", fontSize: 12 }}>
                              {cap.name}
                              <span style={{ color: "var(--e-fg-faint)", marginLeft: 6, fontFamily: "var(--e-mono)", fontSize: 11 }}>
                                {cap.approaches.length > 1 ? `${cap.approaches.length} ways in` : cap.approaches[0]?.crates.slice(0, 3).map(c => c.name).join(" · ") ?? ""}
                              </span>
                            </span>
                          </Link>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>

              <Link href={`/paths/${pathMatch.path.slug}`} className="e-btn e-btn--ghost">
                Open the full route — repos, projects, readiness checklist →
              </Link>
            </div>
          )}

          {/* Org repositories */}
          {orgTopRepos.length > 0 && company && (
            <div style={{ marginBottom: 40 }}>
              <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--e-fg-dim)", marginBottom: 6 }}>
                {company.name} open source
              </div>
              <p style={{ fontSize: 13, color: "var(--e-fg-dim)", marginBottom: 16, lineHeight: 1.5 }}>
                Repositories maintained by the team behind this role.
              </p>
              <div className="e-oss-grid">
                {orgTopRepos.map(repo => (
                  <OSSCard key={repo.href} repo={repo} depPageCounts={depCounts} />
                ))}
              </div>
              {(profile?.repoCount ?? 0) > 4 && (
                <div style={{ marginTop: 12 }}>
                  <Link
                    href={`/ecosystem/${company.slug}`}
                    style={{ fontSize: 13, color: "var(--e-accent)", textDecoration: "none", fontFamily: "var(--e-mono)" }}
                  >
                    View all {profile?.repoCount} repositories →
                  </Link>
                </div>
              )}
            </div>
          )}

          {/* Related funding programs */}
          {relatedPrograms.length > 0 && (
            <div style={{ marginBottom: 40 }}>
              <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--e-fg-dim)", marginBottom: 6 }}>
                Funding available in these ecosystems
              </div>
              <p style={{ fontSize: 13, color: "var(--e-fg-dim)", marginBottom: 16, lineHeight: 1.5 }}>
                Programs that fund open source work in the same ecosystems as this role.
              </p>
              <div className="e-grants">
                {relatedPrograms.map(program => (
                  <GrantCard key={program.slug} program={program} />
                ))}
              </div>
              <div style={{ marginTop: 12 }}>
                <Link href="/grants" style={{ fontSize: 13, color: "var(--e-accent)", textDecoration: "none", fontFamily: "var(--e-mono)" }}>
                  Browse all funding programs →
                </Link>
              </div>
            </div>
          )}

          {/* Footer */}
          <div style={{ paddingTop: 24, borderTop: "1px solid var(--e-line-soft)", display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
            <Link href="/jobs" style={{ fontSize: 13, color: "var(--e-fg-mute)", textDecoration: "none" }}>
              ← All jobs
            </Link>
            <CorrectionLink />
          </div>

        </div>
      </section>
    </EditorialLayout>
  )
}
