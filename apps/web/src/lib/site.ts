/** Single source of truth for public-site SEO values (metadata, sitemap, robots, JSON-LD). */
export const SITE_NAME = "Vende+ WSP";
export const SITE_TITLE = "CRM para WhatsApp con IA";
export const SITE_DESCRIPTION =
  "CRM para WhatsApp con IA: responde con tu catálogo y fuentes, envía presupuestos, haz seguimiento y cobra con pagos verificados. Empieza gratis.";
export const SITE_LOCALE = "es_419";
export const BRAND_COLOR = "#0a1696";

const DEFAULT_SITE_URL = "https://www.vendemas.chat";

/** Canonical origin without trailing slash. NEXT_PUBLIC_SITE_URL overrides it per environment. */
export function getSiteUrl(): string {
  const raw = process.env["NEXT_PUBLIC_SITE_URL"]?.trim();
  if (!raw) return DEFAULT_SITE_URL;
  try {
    return new URL(raw).origin;
  } catch {
    return DEFAULT_SITE_URL;
  }
}

/** Public, indexable marketing routes (kept in sync with robots.ts disallow list). */
export const PUBLIC_ROUTES = [
  { path: "/", changeFrequency: "weekly", priority: 1 },
  { path: "/signup", changeFrequency: "monthly", priority: 0.8 },
  { path: "/login", changeFrequency: "yearly", priority: 0.3 },
  { path: "/integraciones/woocommerce", changeFrequency: "monthly", priority: 0.6 },
] as const;

/** Paths crawlers must not fetch: authenticated app, API proxy and one-off flows. */
export const PRIVATE_PATHS = ["/app", "/admin", "/api", "/invite", "/select-tenant"] as const;

/** ISO date of the last substantive public-content update (JSON-LD dateModified, llms.txt). Bump on content changes. */
export const CONTENT_LAST_MODIFIED = "2026-10-23";

/** BCP 47 tag for structured data (Spanish, Latin America). */
export const SITE_LANG = "es-419";

/** AI search and training crawlers explicitly allowed on public routes. */
export const AI_CRAWLERS = [
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "ClaudeBot",
  "Claude-SearchBot",
  "Claude-User",
  "PerplexityBot",
  "Perplexity-User",
  "Google-Extended",
  "Applebot-Extended",
  "Bingbot",
  "CCBot",
] as const;
