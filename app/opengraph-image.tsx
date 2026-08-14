import { ImageResponse } from "next/og"

export const size = { width: 1200, height: 630 }
export const contentType = "image/png"

// See app/robots.ts: metadata routes must opt in to being prerendered before
// `output: export` will build them. The image is a fixed card, so it renders
// once at build time and ships as a file.
export const dynamic = "force-static"

export default function OgImage() {
  return new ImageResponse(
    <div
      style={{
        width: 1200,
        height: 630,
        background: "#131518",
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "80px 100px",
        fontFamily: "monospace",
        position: "relative",
      }}
    >
      {/* Subtle grid */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
          display: "flex",
        }}
      />

      {/* Logo mark */}
      <div
        style={{
          width: 72,
          height: 72,
          borderRadius: 18,
          background: "linear-gradient(135deg, #d97030 0%, #4f82ec 100%)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "white",
          fontSize: 32,
          fontWeight: 700,
          letterSpacing: "-1px",
          marginBottom: 36,
          flexShrink: 0,
        }}
      >
        r.
      </div>

      {/* Site name */}
      <div
        style={{
          fontSize: 20,
          color: "#686880",
          marginBottom: 20,
          letterSpacing: "0.02em",
          display: "flex",
        }}
      >
        osspath.com
      </div>

      {/* Headline */}
      <div
        style={{
          fontSize: 68,
          fontWeight: 800,
          color: "#f5f5f8",
          lineHeight: 1.05,
          letterSpacing: "-0.04em",
          marginBottom: 28,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <span>What real Rust projects</span>
        <span
          style={{
            background: "linear-gradient(90deg, #d97030 0%, #4f82ec 100%)",
            backgroundClip: "text",
            color: "transparent",
            display: "flex",
          }}
        >
          actually use.
        </span>
      </div>

      {/* Tagline */}
      <div
        style={{
          fontSize: 22,
          color: "#686880",
          marginBottom: 48,
          lineHeight: 1.5,
          maxWidth: 680,
          display: "flex",
        }}
      >
        Crate adoption · Companions · Health · Real codebases
      </div>

      {/* Entity pills */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {["Jobs", "Repos", "Funding", "Orgs", "Ecosystems"].map((tag) => (
          <div
            key={tag}
            style={{
              padding: "7px 16px",
              borderRadius: 8,
              background: "#1a1d22",
              border: "1px solid #2a2d35",
              fontSize: 15,
              color: "#9999b0",
              display: "flex",
            }}
          >
            {tag}
          </div>
        ))}
      </div>
    </div>,
    { ...size },
  )
}
