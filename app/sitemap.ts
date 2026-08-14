import { MetadataRoute } from "next"
import { getQualifiedCrates } from "@/lib/deps-data"
import { getCareerPathSlugs } from "@/lib/career-paths"
import { getQualifiedTopics } from "@/lib/topics-data"
import { getOSSRepos } from "@/lib/oss-data"

// See app/robots.ts: metadata routes must opt in to being prerendered before
// `output: export` will build them.
export const dynamic = "force-static"
import { JOBS } from "@/content/jobs"
import { GRANTS } from "@/content/grants"
import { FUNDERS } from "@/content/funders"
import { COMPANIES } from "@/content/companies"
import { ECO_TAG_ORDER } from "@/lib/eco-tags"

const BASE = "https://osspath.com"

function staticUrls(): MetadataRoute.Sitemap {
  return [
    { url: BASE,                       lastModified: new Date(), changeFrequency: "weekly",  priority: 1.0 },
    { url: `${BASE}/paths`,            lastModified: new Date(), changeFrequency: "weekly",  priority: 0.9 },
    ...getCareerPathSlugs().map(slug => ({
      url: `${BASE}/paths/${slug}`, lastModified: new Date(),
      changeFrequency: "weekly" as const, priority: 0.9,
    })),
    { url: `${BASE}/explore`,          lastModified: new Date(), changeFrequency: "monthly", priority: 0.7 },
    { url: `${BASE}/oss`,              lastModified: new Date(), changeFrequency: "weekly",  priority: 0.9 },
    { url: `${BASE}/jobs`,             lastModified: new Date(), changeFrequency: "daily",   priority: 0.9 },
    { url: `${BASE}/ecosystem`,        lastModified: new Date(), changeFrequency: "weekly",  priority: 0.8 },
    { url: `${BASE}/grants`,           lastModified: new Date(), changeFrequency: "weekly",  priority: 0.8 },
    { url: `${BASE}/funders`,          lastModified: new Date(), changeFrequency: "monthly", priority: 0.7 },
    { url: `${BASE}/events`,           lastModified: new Date(), changeFrequency: "weekly",  priority: 0.7 },
    { url: `${BASE}/pulse`,            lastModified: new Date(), changeFrequency: "monthly", priority: 0.7 },
    { url: `${BASE}/portals`,          lastModified: new Date(), changeFrequency: "monthly", priority: 0.7 },
    { url: `${BASE}/ecosystems`,        lastModified: new Date(), changeFrequency: "weekly",  priority: 0.8 },
    { url: `${BASE}/deps`,             lastModified: new Date(), changeFrequency: "monthly", priority: 0.6 },
    { url: `${BASE}/about`,            lastModified: new Date(), changeFrequency: "yearly",  priority: 0.5 },
    { url: `${BASE}/methodology`,      lastModified: new Date(), changeFrequency: "yearly",  priority: 0.5 },
    { url: `${BASE}/changelog`,        lastModified: new Date(), changeFrequency: "weekly",  priority: 0.5 },
    { url: `${BASE}/contact`,          lastModified: new Date(), changeFrequency: "yearly",  priority: 0.4 },
    { url: `${BASE}/privacy`,          lastModified: new Date(), changeFrequency: "yearly",  priority: 0.2 },
    { url: `${BASE}/terms`,            lastModified: new Date(), changeFrequency: "yearly",  priority: 0.2 },
  ]
}

function repoUrls(): MetadataRoute.Sitemap {
  return getOSSRepos().map((r) => ({
    url: `${BASE}/oss/${r.owner}/${r.name}`,
    lastModified: r.pushedAt ? new Date(r.pushedAt) : new Date(),
    changeFrequency: "monthly" as const,
    priority: 0.7,
  }))
}

function jobUrls(): MetadataRoute.Sitemap {
  return JOBS.map((j) => ({
    url: `${BASE}/jobs/${j.slug}`,
    lastModified: new Date(),
    changeFrequency: "weekly" as const,
    priority: 0.8,
  }))
}

function grantUrls(): MetadataRoute.Sitemap {
  return GRANTS.map((p) => ({
    url: `${BASE}/grants/${p.slug}`,
    lastModified: new Date(),
    changeFrequency: "monthly" as const,
    priority: 0.7,
  }))
}

function funderUrls(): MetadataRoute.Sitemap {
  return FUNDERS.map((f) => ({
    url: `${BASE}/funders/${f.slug}`,
    lastModified: new Date(),
    changeFrequency: "monthly" as const,
    priority: 0.6,
  }))
}

function companyUrls(): MetadataRoute.Sitemap {
  return COMPANIES.map((c) => ({
    url: `${BASE}/ecosystem/${c.slug}`,
    lastModified: new Date(),
    changeFrequency: "monthly" as const,
    priority: 0.6,
  }))
}

function ecosystemUrls(): MetadataRoute.Sitemap {
  return ECO_TAG_ORDER.map((tag) => ({
    url: `${BASE}/ecosystems/${tag}`,
    lastModified: new Date(),
    changeFrequency: "weekly" as const,
    priority: 0.7,
  }))
}

function depUrls(): MetadataRoute.Sitemap {
  return getQualifiedCrates().map((crate) => ({
    url: `${BASE}/deps/${crate}`,
    lastModified: new Date(),
    changeFrequency: "monthly" as const,
    priority: 0.6,
  }))
}

function topicUrls(): MetadataRoute.Sitemap {
  return getQualifiedTopics().map((topic) => ({
    url: `${BASE}/topics/${topic}`,
    lastModified: new Date(),
    changeFrequency: "monthly" as const,
    priority: 0.6,
  }))
}

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    ...staticUrls(),
    ...repoUrls(),
    ...jobUrls(),
    ...grantUrls(),
    ...funderUrls(),
    ...companyUrls(),
    ...ecosystemUrls(),
    ...depUrls(),
    ...topicUrls(),
  ]
}
