import { MetadataRoute } from "next"

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/dashboard", "/api/", "/admin/", "/demo/"],
      },
      // Pure SEO-analysis crawlers, no search/AI referral value, high crawl volume.
      // middleware.ts enforces this list with a 403 — robots.txt is only advisory,
      // and these sweeps are the main driver of the Railway memory bill.
      { userAgent: "AhrefsBot", disallow: "/" },
      { userAgent: "SemrushBot", disallow: "/" },
      { userAgent: "MJ12bot", disallow: "/" },
      { userAgent: "DotBot", disallow: "/" },
      { userAgent: "SERankingBacklinksBot", disallow: "/" },
      { userAgent: "BLEXBot", disallow: "/" },
      { userAgent: "Barkrowler", disallow: "/" },
      { userAgent: "DataForSeoBot", disallow: "/" },
      { userAgent: "MegaIndex", disallow: "/" },
      { userAgent: "InternetMeasurement", disallow: "/" },
    ],
    sitemap: "https://osspath.com/sitemap.xml",
  }
}
