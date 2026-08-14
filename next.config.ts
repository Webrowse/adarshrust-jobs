import type { NextConfig } from "next"
import path from "path"

/**
 * Two builds come out of this config.
 *
 * STATIC_EXPORT=1 produces `out/` — plain HTML/CSS/JS for Cloudflare Pages, and
 * the only thing that serves osspath.com. Everything public is prerendered
 * already (`dynamicParams = false`, zero DB access at request time), so the
 * export is a formality rather than a port.
 *
 * Without it, `next dev` / `next build` produce the full Node server, which is
 * what runs the admin locally.
 */
const STATIC_EXPORT = process.env.STATIC_EXPORT === "1"

/**
 * The admin surface cannot be exported: it needs next-auth DB sessions and
 * server actions. Next has no "exclude this route from the build" switch, so
 * the admin's route files are named `page.node.tsx` / `layout.node.tsx` /
 * `route.node.ts` and `node.tsx`/`node.ts` is added to pageExtensions only for
 * the server build. In the export build those names match no page pattern, so
 * Next never sees a route there and never pulls prisma, next-auth or the
 * server actions into the graph.
 *
 * The alternative — moving app/admin out of the tree for the duration of the
 * build — leaves the working tree broken whenever a build dies half way.
 */
const pageExtensions = STATIC_EXPORT
  ? ["tsx", "ts", "jsx", "js"]
  : ["node.tsx", "node.ts", "tsx", "ts", "jsx", "js"]

const nextConfig: NextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  pageExtensions,
  ...(STATIC_EXPORT ? { output: "export" as const } : {}),
  // headers() and redirects() are inert under `output: export` (Next warns and
  // drops them). Cloudflare Pages serves the same rules from public/_headers
  // and public/_redirects — keep the two in sync.
  ...(STATIC_EXPORT
    ? {}
    : {
        async headers() {
          return [
            {
              source: "/:path*",
              headers: [
                // TLS is Cloudflare-terminated and the site is HTTPS-only. No
                // includeSubDomains: nothing guarantees future subdomains serve TLS.
                { key: "Strict-Transport-Security", value: "max-age=31536000" },
                { key: "X-Content-Type-Options", value: "nosniff" },
                { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
                // Nothing on the site is meant to be framed; this mainly protects
                // /admin from clickjacking.
                { key: "X-Frame-Options", value: "DENY" },
              ],
            },
          ]
        },
        async redirects() {
          return [
            { source: "/companies/:path*", destination: "/", permanent: true },
            { source: "/dashboard/:path*", destination: "/", permanent: true },
            { source: "/workflow",         destination: "/", permanent: true },
            { source: "/sources",          destination: "/", permanent: true },
            { source: "/demo",             destination: "/", permanent: true },
            { source: "/opportunities",    destination: "/jobs", permanent: true },
          ]
        },
      }),
  // pg included: the admin's server actions pull lib/prisma into the server
  // bundle, and webpack cannot bundle pg (conditional cloudflare:sockets
  // import) — it must stay a runtime require. Only the dev/server build has
  // any of this; the export never reaches the admin.
  serverExternalPackages: ["@prisma/client", "@prisma/adapter-pg", "pg"],
  turbopack: {
    root: path.resolve(__dirname),
  },
  images: {
    // No image optimizer exists behind a static export.
    unoptimized: STATIC_EXPORT,
    remotePatterns: [
      {
        protocol: "https",
        hostname: "logo.clearbit.com",
      },
      {
        protocol: "https",
        hostname: "avatars.githubusercontent.com",
      },
      {
        protocol: "https",
        hostname: "lh3.googleusercontent.com",
      },
    ],
  },
}

export default nextConfig
