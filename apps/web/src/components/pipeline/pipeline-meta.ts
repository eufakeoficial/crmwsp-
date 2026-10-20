import type { Opportunity, Stage } from "@crmwsp/contracts";

/** Opportunities grouped by stage id, keeping the API order inside each column. */
export function groupByStage(stages: readonly Stage[], opportunities: readonly Opportunity[]): Map<string, Opportunity[]> {
  const map = new Map<string, Opportunity[]>(stages.map((s) => [s.id, []]));
  for (const o of opportunities) map.get(o.stageId)?.push(o);
  return map;
}

/** Sum of the open values of a column; null values count as 0. Mixed currencies are not summed. */
export function columnTotal(items: readonly Opportunity[]): { currency: string; minor: number } | null {
  const first = items[0];
  if (!first || items.some((o) => o.currency !== first.currency)) return null;
  return { currency: first.currency, minor: items.reduce((n, o) => n + (o.valueMinor ?? 0), 0) };
}

/** Moving needs a write role; the API validates the stage belongs to the pipeline (and the lost reason). */
export function canMoveOpportunities(role: string | undefined): boolean {
  return role === "owner" || role === "admin" || role === "agent";
}
