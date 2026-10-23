import type { MetadataRoute } from "next";
import { AI_CRAWLERS, getSiteUrl, PRIVATE_PATHS } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  const base = getSiteUrl();
  const disallow = [...PRIVATE_PATHS];
  return {
    rules: [
      { userAgent: "*", allow: "/", disallow },
      // Explicit per-bot groups: a crawler matching its own group ignores "*", so repeat the private paths.
      ...AI_CRAWLERS.map((userAgent) => ({ userAgent, allow: "/", disallow })),
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
