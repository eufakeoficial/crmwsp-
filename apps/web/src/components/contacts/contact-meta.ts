import type { ContactBookItem } from "@crmwsp/contracts";

export const CONSENT_LABELS: Record<ContactBookItem["marketingConsent"], string> = {
  granted: "Acepta marketing",
  revoked: "No quiere marketing",
  none: "Sin consentimiento",
};

export function formatWhen(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("es", { dateStyle: "medium", timeStyle: "short" });
}

/** Splits a free-text tag input into clean, unique, bounded tags. */
export function parseTags(raw: string): string[] {
  return [...new Set(raw.split(",").map((t) => t.trim().slice(0, 40)).filter(Boolean))];
}
