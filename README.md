# OSSPath

Explore the Rust ecosystem in one place: 5,600+ open source repositories, the
crates they depend on, companies hiring Rust developers, grants, events, and
learning resources.

Live at **[osspath.com](https://osspath.com)**. Everything on the site is
reviewed before it appears.

## How it works

The site is a published snapshot of a database:

1. A pipeline collects repos, jobs, and other content into Postgres.
2. Publishing (from the admin panel) exports the data as JSON files in
   `content/` and commits them to this repo.
3. That commit triggers a build that prerenders every page.
4. Cloudflare serves the pages from its edge cache.

So visitors only ever see fast static pages. The public site makes no
database calls, and content changes only when a new snapshot is published.

## Run it locally

```bash
npm install
npx prisma generate
npm run dev            # http://localhost:3000
```

Public pages render from the JSON in `content/`, so most UI work needs no
database. The admin panel and the pipeline need a `.env.local` with database
and auth credentials.

## Project layout

| | |
| --- | --- |
| `app/` | Pages — the public site plus the `/admin` control panel |
| `lib/` | Data loaders and the content pipeline |
| `content/` | The published JSON snapshot |
| `scripts/` | Build steps and check suites |

## Contributing

- Suggesting a repo, job, or resource → [CONTRIBUTING.md](CONTRIBUTING.md)
- Working on the code → read [AGENTS.md](AGENTS.md) first. It covers the
  build order, deployment, and the mistakes that have actually cost time here.
