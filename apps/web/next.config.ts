import type { NextConfig } from "next";
import "./src/lib/env-check";

// The browser talks to its own origin; Next forwards /api/* to the API so the
// __Host- session cookie works and the API's Origin check (WEB_ORIGINS) passes.
const apiUrl = (process.env["API_INTERNAL_URL"] ?? "http://localhost:4000").replace(/\/+$/, "");

// CN-006: baseline security headers. React refresh in `next dev` needs eval.
const isDev = process.env["NODE_ENV"] === "development";
// Marketing trackers are allow-listed only when configured (they also need visitor consent at runtime).
const posthogHost = (process.env["NEXT_PUBLIC_POSTHOG_HOST"]?.trim() || "https://us.i.posthog.com").replace(/\/+$/, "");
const posthogAssets = posthogHost.replace("://us.i.", "://us-assets.i.").replace("://eu.i.", "://eu-assets.i.");
const metaOn = Boolean(process.env["NEXT_PUBLIC_META_PIXEL_ID"]?.trim());
const posthogOn = Boolean(process.env["NEXT_PUBLIC_POSTHOG_KEY"]?.trim());
const trackerScripts = [metaOn ? "https://connect.facebook.net" : "", posthogOn ? `${posthogHost} ${posthogAssets}` : ""].filter(Boolean).join(" ");
const trackerConnect = [metaOn ? "https://www.facebook.com https://connect.facebook.net" : "", posthogOn ? `${posthogHost} ${posthogAssets}` : ""].filter(Boolean).join(" ");
const csp = [
  "default-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob: https:",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}${trackerScripts ? ` ${trackerScripts}` : ""}`,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  `connect-src 'self'${trackerConnect ? ` ${trackerConnect}` : ""}`,
].join("; ");

const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=()" },
  { key: "Content-Security-Policy", value: csp },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // The workspace package ships TypeScript sources with ".js" import specifiers.
  transpilePackages: ["@crmwsp/contracts"],
  webpack(config) {
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // Password reset links carry the token in the path: never send it as Referer (overrides the above).
      { source: "/reset/:path*", headers: [{ key: "Referrer-Policy", value: "no-referrer" }] },
    ];
  },
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${apiUrl}/:path*` }];
  },
};

export default nextConfig;
