import type { BroadcastAudience, BroadcastStatus, BroadcastVariableSource } from "@crmwsp/contracts";

/** Allowed campaign transitions: draft -> scheduled -> sending -> completed, cancel from any open state. */
const TRANSITIONS: Record<BroadcastStatus, readonly BroadcastStatus[]> = {
  draft: ["scheduled", "cancelled"],
  scheduled: ["sending", "cancelled"],
  sending: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};

export function canTransitionBroadcast(from: BroadcastStatus, to: BroadcastStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export interface AudienceContact {
  id: string;
  phoneE164: string;
  name: string | null;
  tags: readonly string[];
  extracted: Record<string, unknown>;
  /** Marketing consent: `granted`, `revoked`, or `null` when never asked (excluded by default). */
  marketingConsent: "granted" | "revoked" | null;
}

export function matchesAudience(contact: Pick<AudienceContact, "tags">, audience: BroadcastAudience): boolean {
  const tags = new Set(contact.tags);
  return audience.tags.every((t) => tags.has(t)) && !audience.excludeTags.some((t) => tags.has(t));
}

export function hasMarketingOptIn(contact: Pick<AudienceContact, "marketingConsent">): boolean {
  return contact.marketingConsent === "granted";
}

/** Phone key used for dedupe: digits only, so "+34 600-000" and "+34600000" collide. */
export function phoneKey(phone: string): string {
  return phone.replace(/\D/g, "");
}

export interface ResolvedAudience<C extends AudienceContact = AudienceContact> {
  recipients: C[];
  excludedNoConsent: number;
  duplicates: number;
}

/**
 * Tag filter, then marketing opt-in (no consent row or a revoked one = excluded), then dedupe by
 * phone keeping the first contact. Input order decides which duplicate wins.
 */
export function resolveAudience<C extends AudienceContact>(contacts: readonly C[], audience: BroadcastAudience): ResolvedAudience<C> {
  const seen = new Set<string>();
  const recipients: C[] = [];
  let excludedNoConsent = 0;
  let duplicates = 0;
  for (const c of contacts) {
    if (!matchesAudience(c, audience)) continue;
    if (!hasMarketingOptIn(c)) {
      excludedNoConsent++;
      continue;
    }
    const key = phoneKey(c.phoneE164);
    if (!key || seen.has(key)) {
      duplicates++;
      continue;
    }
    seen.add(key);
    recipients.push(c);
  }
  return { recipients, excludedNoConsent, duplicates };
}

export class MissingTemplateVariableError extends Error {
  constructor(readonly index: number) {
    super(`template variable ${index + 1} has no value`);
    this.name = "MissingTemplateVariableError";
  }
}

function fieldValue(extracted: Record<string, unknown>, key: string): string | null {
  const v = extracted[key];
  if (typeof v === "string" && v.trim()) return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

/** Template params for one contact. Throws `MissingTemplateVariableError` when a value is missing. */
export function resolveBroadcastParams(
  mapping: readonly BroadcastVariableSource[],
  contact: Pick<AudienceContact, "name" | "phoneE164" | "extracted">,
): string[] {
  return mapping.map((m, i) => {
    let v: string | null;
    switch (m.source) {
      case "contact_name":
        v = contact.name?.trim() || m.fallback || null;
        break;
      case "contact_phone":
        v = contact.phoneE164;
        break;
      case "contact_field":
        v = fieldValue(contact.extracted, m.key) ?? m.fallback ?? null;
        break;
      case "static":
        v = m.value;
        break;
    }
    if (!v) throw new MissingTemplateVariableError(i);
    return v;
  });
}

/** Number of `{{n}}` placeholders in a template body (highest index). */
export function countTemplatePlaceholders(body: string): number {
  let max = 0;
  for (const m of body.matchAll(/\{\{\s*(\d+)\s*\}\}/g)) max = Math.max(max, Number(m[1]));
  return max;
}

/** Replies that revoke marketing consent (whole message, case/accents/punctuation-insensitive). */
export const OPT_OUT_KEYWORDS = ["BAJA", "STOP", "UNSUBSCRIBE", "CANCELAR SUSCRIPCION", "DARME DE BAJA", "NO MAS"] as const;

export function isOptOutMessage(body: string | null | undefined): boolean {
  if (!body) return false;
  const norm = body
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (OPT_OUT_KEYWORDS as readonly string[]).includes(norm);
}
