"use client"

import { useState, useTransition } from "react"
import { addSource, setSourceEnabled, setSourceInterval, removeSource } from "@/lib/admin/source-actions"
import type { SourceRow, SourceKind } from "@/lib/admin/sources"
import type { ContentType } from "@/lib/admin/types"
import { CONTENT_TYPES } from "@/lib/admin/content-schema"

const KINDS: SourceKind[] = [
  "hn", "twir", "github-oss", "github-pulse", "github-orgs",
  "events", "portals", "rust-bytes", "careers", "reddit",
  "remoteok", "weworkremotely", "rustler-in",
]
const TYPES: ContentType[] = CONTENT_TYPES

function fmtLast(d: Date | null): string {
  if (!d) return "never"
  return `${new Date(d).toISOString().slice(0, 16).replace("T", " ")}Z`
}

export function SourcesManager({ sources, routableKinds }: { sources: SourceRow[]; routableKinds: string[] }) {
  const [pending, start] = useTransition()
  const [showAdd, setShowAdd] = useState(false)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [form, setForm] = useState({ label: "", kind: "github-oss" as SourceKind, type: "oss" as ContentType, url: "", intervalHours: 24 })

  function toggle(s: SourceRow) {
    start(() => setSourceEnabled(s.id, !s.enabled))
  }
  function changeInterval(s: SourceRow, v: number) {
    if (!Number.isFinite(v) || v < 1) return
    start(() => setSourceInterval(s.id, v))
  }
  function del(s: SourceRow) {
    if (confirmDeleteId !== s.id) { setConfirmDeleteId(s.id); return }
    setConfirmDeleteId(null)
    start(() => removeSource(s.id))
  }
  function submit() {
    if (!form.label.trim()) return
    start(async () => {
      await addSource({ ...form, url: form.url.trim() || null })
      setForm({ label: "", kind: "github-oss", type: "oss", url: "", intervalHours: 24 })
      setShowAdd(false)
    })
  }

  return (
    <div>
      <div className="adm-src-toolbar">
        <button className="adm-btn adm-btn--primary" onClick={() => setShowAdd((v) => !v)} disabled={pending}>
          {showAdd ? "Cancel" : "Add source"}
        </button>
      </div>

      {showAdd && (
        <div className="adm-src-add">
          <input className="adm-input" placeholder="Label" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
          <select className="adm-select" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as SourceKind })}>
            {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
          <select className="adm-select" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as ContentType })}>
            {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <input className="adm-input" placeholder="URL (optional)" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} />
          <input className="adm-input adm-input--num" type="number" min={1} value={form.intervalHours} onChange={(e) => setForm({ ...form, intervalHours: parseInt(e.target.value) || 24 })} />
          <button className="adm-btn adm-btn--primary" onClick={submit} disabled={pending || !form.label.trim()}>Save</button>
        </div>
      )}

      <div className="adm-src-list">
        {sources.length === 0 ? (
          <div className="adm-empty"><span className="adm-empty__label">No sources. Seed with `npm run db:seed-sources`.</span></div>
        ) : sources.map((s) => (
          <div key={s.id} className={`adm-src${s.enabled ? "" : " adm-src--off"}`}>
            <button className={`adm-src__toggle${s.enabled ? " adm-src__toggle--on" : ""}`} onClick={() => toggle(s)} disabled={pending} title={s.enabled ? "Enabled" : "Disabled"} />
            <div className="adm-src__main">
              <span className="adm-src__label">{s.label}</span>
              <span className="adm-src__meta">{s.kind} · {s.type} · last {fmtLast(s.lastRunAt)}</span>
              {/* A kind with no collector is skipped by every run while staying
                  permanently due — the "grants" source sat like this for weeks. */}
              {!routableKinds.includes(s.kind) && (
                <span className="adm-db-warn" style={{ marginLeft: 0 }}>
                  no collector for kind &quot;{s.kind}&quot; — this source never runs
                </span>
              )}
            </div>
            <label className="adm-src__interval">
              every
              <input className="adm-input adm-input--num" type="number" min={1} defaultValue={s.intervalHours} onBlur={(e) => changeInterval(s, parseInt(e.target.value))} disabled={pending} />
              h
            </label>
            <button
              className="adm-btn adm-btn--ghost"
              onClick={() => del(s)}
              onBlur={() => setConfirmDeleteId(null)}
              disabled={pending}
              title={confirmDeleteId === s.id ? "Click again to delete" : "Delete"}
            >
              {confirmDeleteId === s.id ? "Delete?" : "✕"}
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
