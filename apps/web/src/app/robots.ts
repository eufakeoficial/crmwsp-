import type { MetadataRoute } from "next";
import { getSiteUrl, PRIVATE_PATHS } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  const base = getSiteUrl();
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: [...PRIVATE_PATHS] }],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
