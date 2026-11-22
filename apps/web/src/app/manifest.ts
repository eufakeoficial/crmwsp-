import type { MetadataRoute } from "next";
import { BRAND_COLOR, SITE_DESCRIPTION, SITE_NAME } from "@/lib/site";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: SITE_NAME,
    short_name: "Vende+",
    description: SITE_DESCRIPTION,
    start_url: "/app/inbox",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: BRAND_COLOR,
    lang: "es",
    icons: [
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
