"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { createPortal } from "react-dom"
import { useRouter } from "next/navigation"

type SearchEntry = {
  type: string
  title: string
  sub: string
  href: string
  eco?: string[]
}

const TYPE_LABEL: Record<string, string> = {
  crate:     "Crate",
  repo:      "Repository",
  company:   "Company",
  job:       "Job",
  grant:     "Grant",
  funder:    "Funder",
  ecosystem: "Ecosystem",
  community: "Community",
  event:     "Event",
  page:      "Page",
}

// Lower number = ranked first within the same match-quality tier.
// Crates outrank repos: for a crate-name query (tokio, axum) the crate
// intelligence page is the primary destination; the same-named repo follows.
const TYPE_PRIORITY: Record<string, number> = {
  crate:     0,
  repo:      1,
  job:       2,
  grant:     3,
  funder:    4,
  company:   5,
  ecosystem: 6,
  community: 7,
  event:     8,
  page:      9,
}

function search(q: string, index: SearchEntry[]): SearchEntry[] {
  const lq = q.trim().toLowerCase()
  if (!lq) return []

  const exact:    SearchEntry[] = []
  const prefix:   SearchEntry[] = []
  const contains: SearchEntry[] = []

  for (const e of index) {
    // Defensive: a single malformed index entry must never break sitewide search.
    if (typeof e?.title !== "string" || typeof e?.href !== "string") continue
    const t = e.title.toLowerCase()
    const s = (e.sub ?? "").toLowerCase()
    if (t === lq)                              { exact.push(e);   continue }
    if (t.startsWith(lq) || s.startsWith(lq)) { prefix.push(e);  continue }
    if (t.includes(lq)   || s.includes(lq))   { contains.push(e) }
  }

  // Within each match-quality tier, rank by entity type priority (stable sort —
  // same-type entries keep their index order, which for repos is stars descending).
  const byPriority = (a: SearchEntry, b: SearchEntry) =>
    (TYPE_PRIORITY[a.type] ?? 9) - (TYPE_PRIORITY[b.type] ?? 9)
  exact.sort(byPriority)
  prefix.sort(byPriority)
  contains.sort(byPriority)

  // exact.length is a stable boundary used by the prefix-company boost below.
  const exactLen  = exact.length
  const ranked: SearchEntry[] = [...exact, ...prefix, ...contains]

  // ── Company-job boost A: query exactly matches a company name ─────────────────
  // The company's own job listings are promoted to immediately follow the
  // company entry, regardless of what tier the jobs landed in.
  const exactCompany = exact.find(e => e.type === "company")
  if (exactCompany) {
    const cn = exactCompany.title.toLowerCase()
    const jobIdxs: number[] = []
    ranked.forEach((e, i) => {
      if (e.type === "job" && (e.sub ?? "").toLowerCase() === cn) jobIdxs.push(i)
    })
    if (jobIdxs.length > 0) {
      const jobs = jobIdxs.map(i => ranked[i])
      for (let i = jobIdxs.length - 1; i >= 0; i--) ranked.splice(jobIdxs[i], 1)
      const ci = ranked.indexOf(exactCompany)
      ranked.splice(ci + 1, 0, ...jobs)
    }
  }

  // ── Company-job boost B: query prefix-matches exactly one company name ──────────
  // When no exact company match exists, detect company-name search by finding a
  // unique prefix hit. Promote the company and its jobs to the top of the prefix
  // tier so they aren't buried behind org repos from the same sub-field prefix.
  if (!exactCompany) {
    const prefixCos = prefix.filter(
      e => e.type === "company" && e.title.toLowerCase().startsWith(lq)
    )
    if (prefixCos.length === 1) {
      const pc = prefixCos[0]
      const cn = pc.title.toLowerCase()
      const toPromote = [pc, ...ranked.filter(e => e.type === "job" && (e.sub ?? "").toLowerCase() === cn)]
      for (const item of toPromote) {
        const idx = ranked.indexOf(item)
        if (idx >= 0) ranked.splice(idx, 1)
      }
      // Insert right after the exact-tier block
      ranked.splice(exactLen, 0, ...toPromote)
    }
  }

  // ── Ecosystem boost ────────────────────────────────────────────────────────────
  // Surfaces top-starred repos whose PRIMARY eco tag matches the ecosystem in
  // results. Only activates when there are no repos in the exact tier — this
  // suppresses the boost for queries like "tokio" or "axum" (which are also crate
  // names) and reserves it for concept-style queries like "database" or "embedded".
  const hasExactRepo = exact.some(e => e.type === "repo")
  if (!hasExactRepo) {
    const ecoEntry = ranked.find(e => e.type === "ecosystem")
    if (ecoEntry) {
      const ecoTag = ecoEntry.href.split("/").pop() ?? ""
      if (ecoTag) {
        const seen = new Set(ranked)
        const ecoRepos: SearchEntry[] = []
        for (const e of index) {
          if (e.type === "repo" && e.eco?.[0] === ecoTag && !seen.has(e)) {
            ecoRepos.push(e)
            if (ecoRepos.length >= 3) break
          }
        }
        // Promote eco entry to the front of all results, followed by the eco repos.
        // This handles the case where the eco entry is in the prefix tier (e.g. "ai"
        // for the "AI / ML" ecosystem page) and would otherwise be buried by repos.
        const ei = ranked.indexOf(ecoEntry)
        ranked.splice(ei, 1)
        ranked.unshift(ecoEntry, ...ecoRepos)
      }
    }
  }

  return ranked.slice(0, 10)
}

function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true" style={{ flexShrink: 0 }}>
      <circle cx="5.8" cy="5.8" r="4" stroke="currentColor" strokeWidth="1.3" />
      <path d="M9 9L12.5 12.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}

export function CommandPalette() {
  const [open, setOpen]       = useState(false)
  const [query, setQuery]     = useState("")
  const [results, setResults] = useState<SearchEntry[]>([])
  const [active, setActive]   = useState(0)
  const [index, setIndex]     = useState<SearchEntry[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [mounted, setMounted] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const btnRef   = useRef<HTMLButtonElement>(null)
  const router   = useRouter()

  useEffect(() => { setMounted(true) }, [])

  const closeAndReturn = useCallback(() => {
    setOpen(false)
    btnRef.current?.focus()
  }, [])

  // Lazy-load index on first open
  useEffect(() => {
    if (!open) return
    setQuery("")
    setResults([])
    setActive(0)
    setTimeout(() => inputRef.current?.focus(), 10)
    if (index) return

    setLoading(true)
    fetch("/search-index.json")
      .then(r => r.json())
      .then((data: SearchEntry[]) => { setIndex(data); setLoading(false) })
      .catch(() => setLoading(false))
  }, [open])

  // Global keyboard shortcut
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault()
        setOpen(o => !o)
      }
      if (e.key === "Escape" && open) closeAndReturn()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, closeAndReturn])

  // Scroll lock
  useEffect(() => {
    if (!mounted) return
    document.body.style.overflow = open ? "hidden" : ""
    return () => { document.body.style.overflow = "" }
  }, [open, mounted])

  // Run search
  useEffect(() => {
    if (!index) return
    setResults(search(query, index))
    setActive(0)
  }, [query, index])

  function navigate(href: string) {
    closeAndReturn()
    if (href.startsWith("http")) {
      window.open(href, "_blank", "noopener,noreferrer")
    } else {
      router.push(href)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    const len = results.length
    if (!len) return
    if (e.key === "ArrowDown") {
      e.preventDefault()
      setActive(a => (a + 1) % len)
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setActive(a => (a - 1 + len) % len)
    } else if (e.key === "Enter" && results[active]) {
      navigate(results[active].href)
    }
  }

  const modal = (
    <div className="cmd-overlay" onClick={closeAndReturn} role="presentation">
      <div className="cmd-modal" role="dialog" aria-modal="true" aria-label="Search" onClick={e => e.stopPropagation()}>
        <div className="cmd-input-wrap">
          <SearchIcon />
          <input
            ref={inputRef}
            className="cmd-input"
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search repos, jobs, companies…"
            aria-label="Search"
            autoComplete="off"
            spellCheck={false}
          />
          <kbd className="cmd-esc" onClick={closeAndReturn}>esc</kbd>
        </div>

        {query.trim() && results.length > 0 && (
          <ul className="cmd-results" role="listbox" aria-label="Search results">
            {results.map((r, i) => (
              <li
                key={`${r.type}:${r.href}`}
                className={`cmd-item${i === active ? " cmd-item--active" : ""}`}
                role="option"
                aria-selected={i === active}
                onMouseEnter={() => setActive(i)}
                onClick={() => navigate(r.href)}
              >
                <span className="cmd-item__type">{TYPE_LABEL[r.type] ?? r.type}</span>
                <span className="cmd-item__title">{r.title}</span>
                {r.sub && <span className="cmd-item__sub">{r.sub}</span>}
              </li>
            ))}
          </ul>
        )}

        {query.trim() && !loading && results.length === 0 && (
          <div className="cmd-empty">No results for &ldquo;{query.trim()}&rdquo;</div>
        )}

        {!query.trim() && (
          <div className="cmd-hint">
            {loading
              ? "Loading…"
              : index
                ? `Search ${index.length.toLocaleString()} repos, jobs, companies, and more.`
                : "Loading index…"}
          </div>
        )}
      </div>
    </div>
  )

  return (
    <>
      <button
        ref={btnRef}
        className="cmd-btn"
        onClick={() => setOpen(true)}
        aria-label="Open search (⌘K)"
        type="button"
      >
        <SearchIcon />
        <span className="cmd-btn__label">Search</span>
        <kbd className="cmd-btn__hint">⌘K</kbd>
      </button>
      {mounted && open && createPortal(modal, document.body)}
    </>
  )
}
