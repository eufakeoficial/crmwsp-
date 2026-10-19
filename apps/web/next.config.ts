import type { NextConfig } from "next";

// The browser talks to its own origin; Next forwards /api/* to the API so the
// __Host- session cookie works and the API's Origin check (WEB_ORIGINS) passes.
const apiUrl = (process.env["API_INTERNAL_URL"] ?? "http://localhost:4000").replace(/\/+$/, "");

const nextConfig: NextConfig = {
  // The workspace package ships TypeScript sources with ".js" import specifiers.
  transpilePackages: ["@crmwsp/contracts"],
  webpack(config) {
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${apiUrl}/:path*` }];
  },
};

export default nextConfig;
