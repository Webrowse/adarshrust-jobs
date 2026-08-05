import Link from "next/link"
import { readContent } from "@/lib/admin/storage"
import { CONTENT_SCHEMA, CONTENT_TYPES } from "@/lib/admin/content-schema"
import type { ContentType } from "@/lib/admin/types"
import { BulkDeleteButton } from "@/components/admin/bulk-delete-button"
import { AddPublishedButton } from "@/components/admin/add-published-button"
import { PublishedSearch } from "@/components/admin/published-search"
import { isAdmin } from "@/lib/admin/require-admin"

const TABS: ContentType[] = CONTENT_TYPES

interface PageProps {
  searchParams: Promise<{ type?: string }>
}

export default async function PublishedPage({ searchParams }: PageProps) {
  if (!(await isAdmin())) return null
  const { type = "jobs" } = await searchParams
  const activeType = (TABS.includes(type as ContentType) ? type : "jobs") as ContentType
  const allItems = await readContent(activeType)
  const indexed = allItems.map((item, index) => ({ item, index }))

  return (
    <>
      <div className="adm-tabs">
        {TABS.map((t) => (
          <Link
            key={t}
            href={`/admin/published?type=${t}`}
            className={`adm-tab${activeType === t ? " adm-tab--active" : ""}`}
          >
            {CONTENT_SCHEMA[t].label}
          </Link>
        ))}
      </div>

      <div className="adm-page-header">
        <span className="adm-page-title">Published — {CONTENT_SCHEMA[activeType].label}</span>
        <span className="adm-page-meta">{allItems.length} entries</span>
        <AddPublishedButton contentType={activeType} />
        <BulkDeleteButton contentType={activeType} count={allItems.length} />
      </div>

      <div className="adm-content">
        {allItems.length === 0 ? (
          <div className="adm-empty">
            <span className="adm-empty__label">No published {activeType}</span>
          </div>
        ) : (
          <PublishedSearch items={indexed} contentType={activeType} />
        )}
      </div>
    </>
  )
}
