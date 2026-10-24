/**
 * Daily policy monitor helpers (ADR 0021, T3): sources, text normalization and a line diff.
 * Hashing lives in the worker (node:crypto); this module stays pure.
 */

export interface PolicySource {
  key: string;
  label: string;
  url: string;
}

/**
 * Official sources from docs/research/politicas-meta-whatsapp-2026-10.md §5. Only hosts whose
 * plain fetch returns the content (.md / llms.txt / whatsappbusiness.com); facebook.com/legal and
 * the commerce policy need a headless browser and their robots note discourages scraping: left out.
 */
export const POLICY_SOURCES: readonly PolicySource[] = [
  { key: "messaging_policy", label: "WhatsApp Business Messaging Policy", url: "https://whatsappbusiness.com/policy/?lang=en_US" },
  { key: "docs_index", label: "Índice de documentación (llms.txt)", url: "https://developers.facebook.com/documentation/business-messaging/whatsapp/llms.txt" },
  { key: "ai_providers", label: "Política de precios AI Providers", url: "https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/ai-providers.md" },
  { key: "changelog", label: "Changelog de WhatsApp", url: "https://developers.facebook.com/documentation/business-messaging/whatsapp/changelog" },
  { key: "policy_enforcement", label: "Enforcement de políticas", url: "https://developers.facebook.com/documentation/business-messaging/whatsapp/policy-enforcement" },
  { key: "display_names", label: "Display names", url: "https://developers.facebook.com/documentation/business-messaging/whatsapp/display-names" },
];

const ENTITIES: Record<string, string> = { "&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&apos;": "'" };

/** Plain, stable text: no scripts/styles/comments/tags, decoded basic entities, trimmed lines. */
export function normalizePolicyText(raw: string, contentType = "text/plain"): string {
  let t = raw.replace(/\r\n?/g, "\n").replace(/<!--[\s\S]*?-->/g, "");
  if (/html/i.test(contentType) || /<html|<body|<p[\s>]/i.test(t)) {
    t = t
      .replace(/<(script|style|noscript|svg|template)\b[\s\S]*?<\/\1>/gi, "")
      .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section|\/article|h[1-6]|p|li|div)\b[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, "");
  }
  t = t.replace(/&(nbsp|amp|lt|gt|quot|#39|apos);/g, (m) => ENTITIES[m] ?? m);
  return t
    .split("\n")
    .map((l) => l.replace(/[\t ]+/g, " ").trim())
    .filter((l) => l !== "")
    .join("\n");
}

export interface PolicyDiff {
  added: string[];
  removed: string[];
  /** "+ line" / "- line", capped at maxLines with a "… N más" tail; "" when nothing changed. */
  summary: string;
}

/** Set-based line diff (order changes are ignored on purpose: policies rarely reorder). */
export function diffPolicyText(prev: string, next: string, maxLines = 60): PolicyDiff {
  const a = prev ? prev.split("\n") : [];
  const b = next ? next.split("\n") : [];
  const inA = new Set(a);
  const inB = new Set(b);
  const added = b.filter((l) => !inA.has(l));
  const removed = a.filter((l) => !inB.has(l));
  const lines = [...removed.map((l) => `- ${l.slice(0, 300)}`), ...added.map((l) => `+ ${l.slice(0, 300)}`)];
  const shown = lines.slice(0, maxLines);
  if (lines.length > maxLines) shown.push(`… ${lines.length - maxLines} más`);
  return { added, removed, summary: shown.join("\n") };
}
