import type { NextConfig } from "next";

/** The workspace API runs as a separate FastAPI process (it needs pyspark to
 *  speak Spark Connect's gRPC protocol). Proxying it under /api keeps the
 *  browser on one origin, so no CORS negotiation is involved. */
const API_TARGET = process.env.LAKEHOUSE_API_URL ?? "http://127.0.0.1:8090";

const nextConfig: NextConfig = {
  // The dev overlay badge sits on top of the sidebar's collapse control.
  devIndicators: false,

  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API_TARGET}/api/:path*` }];
  },
};

export default nextConfig;
