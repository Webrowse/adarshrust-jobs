# Contributing to OSSPath

This site is manually curated. It stays useful by staying small.

## What qualifies

### Remote Rust Jobs

A job listing is included when ALL of these are true:
- The role explicitly mentions Rust in the job description (not inferred)
- Remote work is confirmed by the company (not "remote-friendly" ambiguity)
- The careers page is accessible and current
- The company's Rust usage is in production, not experimental

**Not included:**
- Roles where "Rust" is one of five acceptable languages
- Companies where Rust usage is rumoured or inferred
- Listings that require in-office attendance
- Recruiting agencies or third-party boards

### OSS Paths

A repository is included when ALL of these are true:
- The maintainer(s) respond to issues and PRs within a reasonable timeframe
- Issues are labelled or described with enough context to act on
- The project is actively maintained (commit activity in the last 90 days)
- There is a realistic path for a new contributor to make a meaningful contribution

**Not included:**
- Famous repositories where the contributor queue is years long
- Abandoned or archived projects
- Projects where the maintainer does not welcome outside contributions

### Ecosystem Pulse

A resource is included when:
- It covers the Rust ecosystem specifically (not just general programming)
- It is actively maintained (newsletter published, forum active)
- It has non-trivial signal-to-noise ratio

**Not included:**
- Generic programming newsletters that occasionally mention Rust
- Inactive forums or communities

### Grants & Bounties

A funding opportunity is included when:
- The program is currently open or has a defined recurring cycle
- The funding explicitly supports Rust ecosystem work
- The application path is clear

**Not included:**
- General open-source grants with no Rust focus
- Programs that have been closed for more than a year

### Companies

A company is included when:
- Rust usage in production is publicly documented
- The company has published blog posts, conference talks, or OSS repos demonstrating Rust use
- The usage is in a core product, not just tooling

**Not included:**
- Companies where Rust usage is inferred from job postings
- Companies that used Rust experimentally but switched away
- Companies that use Rust only in a non-strategic internal tool

### Crate pages

Crate pages under `/deps` are **derived, not curated**. A crate gets a page automatically
once at least **25 repositories in the corpus depend on it**; below that it returns 404 by
design. There is no manual override — the way to give a crate a page is to grow the corpus
coverage that justifies it.

---

## Review intervals

Content is expected to be re-verified on a regular schedule:
- Jobs: every 7 days
- Grants: every 14 days
- OSS paths: every 30 days
- Events: every 14 days
- Pulse / Companies: every 60 days

Run `npx tsx scripts/validate-content.ts` to check for stale entries.

**These intervals are aspirational for the repository corpus.** They were written when the
corpus was small and hand-checked. Against 5,394 repos the validator currently reports
~4,700 stale warnings, because the 30-day OSS review interval was never realistic at that
scale — repo freshness is maintained by the weekly GitHub metadata refresh instead. Treat
the intervals as binding for the hand-curated surfaces (jobs, grants, events, pulse,
companies) and read the repo warnings as noise until the interval is rebased.

The **errors** it reports are real and worth fixing — currently 7 duplicate entries
(`Copods — Rust Engineer`, `Deno`, `Bun`, `Alacritty` ×2, `Union`, `Open Interpreter`).

---

## How to submit

To suggest a new entry, open a GitHub issue with:
1. The URL of the resource
2. Why it meets the inclusion criteria above
3. Any context that would help write an accurate note

The curators verify and add manually. There is no automated ingestion.

---

## What this site is not

- Not a scraper
- Not a job board with infinite listings
- Not an AI-curated feed
- Not a comprehensive directory

The value is in what is excluded, not just what is included.
