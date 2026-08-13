import type { NextConfig } from "next"
import path from "path"

const nextConfig: NextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  // Serving-path memory: don't hold rendered pages in an in-process LRU (default
  // 50 MB). Cloudflare caches the hot pages at the edge and the OS page cache
  // covers disk reads, so the LRU only adds to average RSS — which is what
  // Railway bills.
  cacheMaxMemorySize: 0,
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
  // pg included: instrumentation-node.ts pulls lib/prisma into the server
  // bundle at boot, and webpack cannot bundle pg (conditional
  // cloudflare:sockets import) — it must stay a runtime require.
  serverExternalPackages: ["@prisma/client", "@prisma/adapter-pg", "pg"],
  turbopack: {
    root: path.resolve(__dirname),
  },
  images: {
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
