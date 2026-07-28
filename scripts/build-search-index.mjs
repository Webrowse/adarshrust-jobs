#!/usr/bin/env node
/**
 * Generates public/search-index.json from all content sources.
 * Run via: node scripts/build-search-index.mjs
 * Invoked automatically as "prebuild" in package.json.
 */
import { readFileSync, writeFileSync } from "fs"
import { join, dirname } from "path"
import { fileURLToPath } from "url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, "..")

function load(rel) {
  return JSON.parse(readFileSync(join(ROOT, rel), "utf8"))
}

// ── Ecosystem tag detection ───────────────────────────────────────────────────
// Inlined from lib/eco-tags.ts — keep in sync with that file.

// Manual overrides — loaded from content/eco-overrides.json
const ECO_OVERRIDES = load("content/eco-overrides.json")

const BLOCKCHAIN_OWNERS = new Set([
  "FuelLabs", "paritytech", "foundry-rs", "paradigmxyz", "alloy-rs",
  "gakonst", "bluealloy", "solana-labs", "near", "MystenLabs",
  "starkware-libs", "succinctlabs", "axiom-crypto", "risc0",
  "ethereum", "ethereum-optimism", "a16z", "matter-labs", "scroll-tech",
])

const BLOCKCHAIN_TOPICS = new Set([
  "blockchain", "ethereum", "evm", "smart-contract", "smart-contracts",
  "defi", "rollup", "web3", "layer2", "zkvm", "zk-proofs",
  "zero-knowledge", "solana", "bitcoin", "layer-2",
  "l2", "zkevm", "zkp", "cryptocurrency",
])

// V1.5: expanded embedded signals
const EMBEDDED_OWNERS = new Set([
  "esp-rs", "embassy-rs", "rp-rs", "knurling-rs", "tock",
  "rust-embedded", "stm32-rs", "nrf-rs", "atsamd-rs",
])

const EMBEDDED_TOPICS = new Set([
  "no-std", "no_std", "cortex-m", "microcontroller", "rtos", "bare-metal",
  "esp32", "esp8266", "stm32", "nrf52", "rp2040", "avr",
  "risc-v", "arm-cortex-m", "embedded-hal",
])

const AI_TOPICS = new Set([
  "machine-learning", "deep-learning", "llm", "neural-network", "inference",
  "large-language-model", "generative-ai", "ai", "rag", "computer-vision",
])

const WASM_TOPICS = new Set([
  "wasm", "webassembly", "wasi", "web-assembly",
])

// V1.5: tokio requires additional ecosystem signal beyond the dep itself
const TOKIO_ECOSYSTEM_DEPS = new Set([
  "tokio-stream", "tokio-util", "tower", "tower-service",
])

const ECO_RULES = [
  ["bevy",       (d, _o, _t) => [...d].some(x => x === "bevy" || x.startsWith("bevy_") || x.startsWith("bevy-"))],
  ["tauri",      (d, _o, _t) => d.has("tauri") || [...d].some(x => x.startsWith("tauri-plugin"))],
  ["blockchain", (d,  o,  t) =>
    d.has("alloy-primitives") || d.has("alloy-sol-types") || d.has("alloy") ||
    d.has("alloy-consensus") || d.has("alloy-network") || d.has("revm") ||
    d.has("solana-sdk") || d.has("solana-client") || d.has("anchor-lang") ||
    d.has("ethers") || d.has("ethers-core") || d.has("frame-support") ||
    d.has("frame-system") || d.has("fuels") || d.has("fuel-core") || d.has("sp1-sdk") ||
    BLOCKCHAIN_OWNERS.has(o ?? "") || t.some(x => BLOCKCHAIN_TOPICS.has(x))],
  // V1.5: +owner list +hardware topic fallback
  ["embedded",   (d, o, t) =>
    d.has("embedded-hal") || d.has("cortex-m") || d.has("rtic") ||
    d.has("embassy-executor") || d.has("defmt") || d.has("embassy-rp") ||
    d.has("embassy-nrf") || d.has("embassy-stm32") || d.has("embassy-usb") ||
    d.has("nrf-hal-common") || d.has("stm32f4xx-hal") || d.has("stm32h7xx-hal") ||
    d.has("rp2040-hal") || d.has("avr-hal") || d.has("probe-rs") ||
    EMBEDDED_OWNERS.has(o ?? "") || t.some(x => EMBEDDED_TOPICS.has(x))],
  // V1.5: +AI topic fallback for LLM clients, AI tooling, vector DBs
  ["ai",         (d, _o, t) =>
    d.has("candle-core") || d.has("tch") || d.has("ort") || d.has("async-openai") ||
    d.has("llm") || d.has("tokenizers") || d.has("fastembed") || d.has("burn") ||
    d.has("burn-core") || d.has("mistralrs") || d.has("llama-cpp-rs") ||
    d.has("kalosm") || d.has("openai") || d.has("anthropic") ||
    t.some(x => AI_TOPICS.has(x))],
  // V1.5: +WASM topic fallback for WASM infrastructure
  ["wasm",       (d, _o, t) =>
    d.has("wasm-bindgen") || d.has("wasmtime") || d.has("wasmer") ||
    d.has("js-sys") || d.has("leptos") || d.has("yew") || d.has("dioxus") ||
    t.some(x => WASM_TOPICS.has(x))],
  ["database",   (d) =>
    d.has("sqlx") || d.has("diesel") || d.has("sea-orm") || d.has("rusqlite") ||
    d.has("mongodb") || d.has("redb") || d.has("redis") || d.has("sled")],
  ["grpc",       (d) => d.has("tonic") || d.has("tonic-build")],
  // V1.5: clap removed — too ubiquitous to be a meaningful identity signal
  ["cli",        (d, _o, t) =>
    d.has("ratatui") || d.has("crossterm") || d.has("tui") || d.has("reedline") ||
    d.has("inquire") ||
    t.some(x => x === "cli" || x === "tui" || x === "terminal" || x === "command-line" ||
                x === "command-line-tool" || x === "command-line-interface")],
  ["axum",       (d) => d.has("axum") || d.has("actix-web") || d.has("rocket")],
  // V1.5: tokio requires at least one ecosystem-specific crate or explicit topic
  ["tokio",      (d, _o, t) =>
    d.has("tokio") && (
      [...d].some(x => TOKIO_ECOSYSTEM_DEPS.has(x)) ||
      t.includes("tokio") ||
      t.includes("asynchronous")
    )],
]

function getEcoTags(deps, owner, name, topics) {
  // Manual overrides take precedence over all rule evaluation
  if (owner && name) {
    const key = `${owner}/${name}`
    const override = ECO_OVERRIDES[key]
    if (override) return override
  }

  const d = new Set(deps ?? [])
  const t = topics ?? []
  const tags = []
  for (const [tag, check] of ECO_RULES) {
    if (check(d, owner, t)) {
      tags.push(tag)
      if (tags.length === 2) break
    }
  }
  return tags
}

// ── Ecosystem page titles (must match what command-palette.tsx uses) ──────────
const ECO_LABEL = {
  bevy:       "Bevy",
  tauri:      "Tauri",
  blockchain: "Blockchain",
  embedded:   "Embedded",
  ai:         "AI / ML",
  wasm:       "WebAssembly",
  database:   "Database",
  grpc:       "gRPC",
  cli:        "CLI Tooling",
  axum:       "Axum",
  tokio:      "Tokio",
}

const entries = []

// ── Static pages ─────────────────────────────────────────────────────────────
const PAGES = [
  { title: "Jobs",          sub: "Rust job listings",       href: "/jobs" },
  { title: "Repositories",  sub: "Open source Rust repos",  href: "/oss" },
  { title: "Funding",       sub: "Grants and programs",     href: "/grants" },
  { title: "Ecosystems",    sub: "Browse by ecosystem tag", href: "/ecosystems" },
  { title: "Organizations", sub: "Companies in the atlas",  href: "/ecosystem" },
  { title: "Community",     sub: "Pulse — forums and blogs",href: "/pulse" },
  { title: "Events",        sub: "Conferences and meetups", href: "/events" },
  { title: "Job Boards",    sub: "Where to find Rust jobs", href: "/portals" },
  { title: "About",         sub: "About OSSPath",           href: "/about" },
  { title: "Methodology",   sub: "How entries are curated", href: "/methodology" },
  { title: "Contact",       sub: "Report a correction",     href: "/contact" },
]
for (const p of PAGES) entries.push({ type: "page", title: p.title, sub: p.sub, href: p.href })

// ── Ecosystem tag pages ───────────────────────────────────────────────────────
for (const [tag, label] of Object.entries(ECO_LABEL)) {
  entries.push({ type: "ecosystem", title: label, sub: "Ecosystem", href: `/ecosystems/${tag}` })
}

// ── Jobs (active only) ────────────────────────────────────────────────────────
const JOBS = load("content/jobs.json")
const now  = new Date()
for (const j of JOBS) {
  if (j.expiresAt && new Date(j.expiresAt) <= now) continue
  entries.push({ type: "job", title: j.role, sub: j.company, href: `/jobs/${j.slug}` })
}

// ── Companies ─────────────────────────────────────────────────────────────────
const COMPANIES = load("content/companies.json")
for (const c of COMPANIES) {
  entries.push({ type: "company", title: c.name, sub: c.sector, href: `/ecosystem/${c.slug}` })
}

// ── Grants ────────────────────────────────────────────────────────────────────
const GRANTS = load("content/grants.json")
for (const p of GRANTS) {
  entries.push({ type: "grant", title: p.name, sub: p.status, href: `/grants/${p.slug}` })
}

// ── Funders ───────────────────────────────────────────────────────────────────
const FUNDERS = load("content/funders.json")
for (const f of FUNDERS) {
  entries.push({ type: "funder", title: f.name, sub: f.kind, href: `/funders/${f.slug}` })
}

// ── Pulse / Community ─────────────────────────────────────────────────────────
const PULSE = load("content/pulse.json")
for (const item of PULSE) {
  entries.push({ type: "community", title: item.title, sub: item.kind, href: item.href })
}

// ── Events ────────────────────────────────────────────────────────────────────
const EVENTS = load("content/events.json")
for (const e of EVENTS) {
  entries.push({ type: "event", title: e.title, sub: e.meta, href: e.href })
}

// ── OSS repositories (sorted by stars desc so eco-boost picks flagship repos) ──
const OSS = load("content/oss.json")
const sortedOSS = [...OSS].sort((a, b) => (b.stars ?? 0) - (a.stars ?? 0))
for (const r of sortedOSS) {
  const eco = getEcoTags(r.dependencies, r.owner, r.name, r.topics)
  const entry = { type: "repo", title: r.name, sub: r.owner, href: `/oss/${r.owner}/${r.name}` }
  if (eco.length > 0) entry.eco = eco
  entries.push(entry)
}

// ── Crates with dedicated /deps pages ─────────────────────────────────────────
// Membership: companion-index repoCount >= 25 — keep in sync with
// DEP_PAGE_THRESHOLD in lib/deps-data.ts (same rule that decides which
// /deps/[crate] pages exist). Displayed counts are live from oss.json so the
// palette agrees with the pages it links to.
const DEP_PAGE_THRESHOLD = 25
const COMPANION_INDEX = load("content/oss-companion-index.json")
const liveDepCounts = {}
for (const r of OSS) {
  for (const d of r.dependencies ?? []) {
    liveDepCounts[d] = (liveDepCounts[d] ?? 0) + 1
  }
}
const qualifiedCrates = Object.entries(COMPANION_INDEX)
  .filter(([, v]) => v.repoCount >= DEP_PAGE_THRESHOLD)
  .map(([name]) => name)
  .sort((a, b) => (liveDepCounts[b] ?? 0) - (liveDepCounts[a] ?? 0))
for (const name of qualifiedCrates) {
  entries.push({
    type:  "crate",
    title: name,
    sub:   `${(liveDepCounts[name] ?? 0).toLocaleString("en-US")} repos use it`,
    href:  `/deps/${name}`,
  })
}

// ── Write ─────────────────────────────────────────────────────────────────────
// Drop malformed entries. A single record with a missing title/sub (e.g. a job
// whose extraction failed and produced no role/company) used to ship into the
// index and throw on every keystroke in the palette, breaking search sitewide.
const valid = entries.filter(
  e => typeof e.title === "string" && e.title.trim() !== "" && typeof e.href === "string" && e.href.trim() !== ""
)
for (const e of valid) if (typeof e.sub !== "string") e.sub = ""

const dropped = entries.length - valid.length
if (dropped > 0) {
  const byType = {}
  for (const e of entries) {
    if (valid.includes(e)) continue
    byType[e.type] = (byType[e.type] ?? 0) + 1
  }
  console.warn(`⚠ dropped ${dropped} malformed entries: ${JSON.stringify(byType)}`)
}

const out     = join(ROOT, "public/search-index.json")
const payload = JSON.stringify(valid)
writeFileSync(out, payload)

const repoCount    = sortedOSS.length
const ecoTagged    = sortedOSS.filter(r => getEcoTags(r.dependencies, r.owner, r.name, r.topics).length > 0).length
const kb           = (Buffer.byteLength(payload) / 1024).toFixed(1)
console.log(`✓ search-index.json — ${valid.length} entries, ${kb} KB raw`)
console.log(`  repos: ${repoCount} (${ecoTagged} with eco tags, sorted by stars)`)
console.log(`  crates: ${qualifiedCrates.length} (live counts, sorted by usage)`)
