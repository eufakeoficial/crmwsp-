/**
 * BSP template listing reconciliation and the "may this template be sent" rule. Structural types
 * only: the domain package does not depend on the WhatsApp adapters.
 */

export type TemplateStatusValue = "approved" | "pending" | "rejected" | "paused" | "disabled";

/** Max stored length of a rejection reason (the BSP text is untrusted free text). */
export const MAX_REJECTION_REASON_LENGTH = 200;

/** Template as the BSP reports it (subset of `ProviderTemplate`). */
export interface RemoteTemplate {
  externalId: string;
  name: string;
  language: string;
  category: "marketing" | "utility" | "authentication";
  status: TemplateStatusValue;
  body: string;
  reason?: string | undefined;
}

export interface LocalTemplateRow {
  id: string;
  name: string;
  language: string;
  status: string;
  externalId: string | null;
  rejectionReason?: string | null | undefined;
}

export interface TemplateSyncUpdate {
  id: string;
  status: TemplateStatusValue;
  externalId: string;
  /** Set only while the template is rejected; null clears a stale reason. */
  rejectionReason: string | null;
}

export interface TemplateSyncPlan<T extends RemoteTemplate = RemoteTemplate> {
  updates: TemplateSyncUpdate[];
  /** Present at the BSP (e.g. created in its console) but unknown locally. */
  inserts: T[];
  /** Rejection reasons reported in this listing (also persisted through `updates`/`inserts`). */
  rejections: Array<{ name: string; language: string; reason: string }>;
}

/** Normalizes a BSP/webhook reason: only meaningful for rejected templates, trimmed and capped. */
export function normalizeRejectionReason(status: string, reason: string | null | undefined): string | null {
  if (status !== "rejected") return null;
  const r = reason?.trim();
  return r ? r.slice(0, MAX_REJECTION_REASON_LENGTH) : null;
}

const keyOf = (name: string, language: string): string => `${name}\u0000${language}`;

/**
 * Pure reconciliation of the BSP listing against local rows, keyed by (name, language). Local rows
 * missing from the listing are left alone (a just-submitted template may lag).
 */
export function planTemplateSync<T extends RemoteTemplate>(local: readonly LocalTemplateRow[], remote: readonly T[]): TemplateSyncPlan<T> {
  const byKey = new Map(local.map((l) => [keyOf(l.name, l.language), l]));
  const plan: TemplateSyncPlan<T> = { updates: [], inserts: [], rejections: [] };
  for (const r of remote) {
    const reason = normalizeRejectionReason(r.status, r.reason);
    if (reason) plan.rejections.push({ name: r.name, language: r.language, reason });
    const l = byKey.get(keyOf(r.name, r.language));
    if (!l) {
      plan.inserts.push(r);
    } else if (l.status !== r.status || l.externalId !== r.externalId || (l.rejectionReason ?? null) !== reason) {
      plan.updates.push({ id: l.id, status: r.status, externalId: r.externalId, rejectionReason: reason });
    }
  }
  return plan;
}

export type TemplateSendIssue = "not_approved" | "no_external_id";

/**
 * Only an APPROVED template with a BSP id may be sent outside the 24 h window (follow-ups,
 * broadcasts, manual inbox sends). Pending/rejected/paused/disabled never go out.
 */
export function templateSendIssue(t: { status: string; externalId?: string | null | undefined }, opts: { requireExternalId?: boolean } = {}): TemplateSendIssue | null {
  if (t.status !== "approved") return "not_approved";
  if (opts.requireExternalId && !t.externalId) return "no_external_id";
  return null;
}

export const isTemplateSendable = (status: string): boolean => status === "approved";
