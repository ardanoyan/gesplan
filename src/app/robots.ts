import type { MetadataRoute } from "next";

// A prototype with unverified partner data: no crawler should index any of it. The noindex
// meta tag (layout.tsx) and X-Robots-Tag header (next.config.ts) cover crawlers that ignore this.
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", disallow: "/" } };
}
