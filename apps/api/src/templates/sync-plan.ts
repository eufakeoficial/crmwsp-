import type { ProviderTemplate } from "@crmwsp/whatsapp";

export interface LocalTemplateRow {
  id: string;
  name: string;
  language: string;
  status: string;
  externalId: string | null;
}

export interface TemplateSyncPlan {
  updates: Array<{ id: string; status: ProviderTemplate["status"]; externalId: string }>;
  inserts: ProviderTemplate[];
  rejections: Array<{ name: string; language: string; reason: string }>;
}

const keyOf = (name: string, language: string): string => `${name}\u0000${language}`;

/**
 * Reconciles the BSP listing with local rows by (name, language). Same rules as the worker's periodic
 * sync: rows missing from the listing are left alone (a just-submitted template may lag).
 */
export function planTemplateSync(local: readonly LocalTemplateRow[], remote: readonly ProviderTemplate[]): TemplateSyncPlan {
  const byKey = new Map(local.map((l) => [keyOf(l.name, l.language), l]));
  const plan: TemplateSyncPlan = { updates: [], inserts: [], rejections: [] };
  for (const r of remote) {
    if (r.status === "rejected" && r.reason) plan.rejections.push({ name: r.name, language: r.language, reason: r.reason });
    const l = byKey.get(keyOf(r.name, r.language));
    if (!l) plan.inserts.push(r);
    else if (l.status !== r.status || l.externalId !== r.externalId) plan.updates.push({ id: l.id, status: r.status, externalId: r.externalId });
  }
  return plan;
}
