import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keeps every response, API JSON included, out of search indexes (see src/app/robots.ts).
  async headers() {
    return [{ source: "/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] }];
  },
};

export default nextConfig;
