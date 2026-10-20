/**
 * Plans and usage limits (pure domain, no I/O). Plan definitions mirror the landing pricing
 * section (apps/web/src/components/landing/PricingSection.tsx): keep both in sync.
 *
 * Subscription charging is OUT OF SCOPE: no payment provider bills the plan yet. The plan of a
 * tenant is set by the platform (system/migrator role, never the app role) in `tenant_plans`
 * (migration 0023) and only enforced here.
 */

export const PLAN_IDS = ["start", "pro"] as const;
export type PlanId = (typeof PLAN_IDS)[number];

export const LIMIT_KEYS = ["ai_messages", "contacts", "seats", "broadcast_sends", "whatsapp_numbers"] as const;
export type LimitKey = (typeof LIMIT_KEYS)[number];

/** Limits that reset every calendar month (stored as counters); the rest are current totals. */
export const MONTHLY_LIMIT_KEYS = ["ai_messages", "broadcast_sends"] as const satisfies readonly LimitKey[];
export type MonthlyLimitKey = (typeof MONTHLY_LIMIT_KEYS)[number];

export interface PlanDefinition {
  id: PlanId;
  name: string;
  priceMonthlyUsd: number;
  /** Annual price: 10 months (2 free), as advertised. */
  priceAnnualUsd: number;
  /** `null` = unlimited, `0` = feature not included. */
  limits: Record<LimitKey, number | null>;
}

/**
 * Seats, contacts and numbers come from the landing. `ai_messages` and `broadcast_sends` are not
 * advertised there: the values below are product defaults (broadcasts are a Pro-only feature).
 */
export const PLANS: Record<PlanId, PlanDefinition> = {
  start: {
    id: "start",
    name: "Start",
    priceMonthlyUsd: 49,
    priceAnnualUsd: 490,
    limits: { ai_messages: 2_000, contacts: 10_000, seats: 5, broadcast_sends: 0, whatsapp_numbers: 2 },
  },
  pro: {
    id: "pro",
    name: "Pro",
    priceMonthlyUsd: 89,
    priceAnnualUsd: 890,
    limits: { ai_messages: 10_000, contacts: 30_000, seats: 15, broadcast_sends: 30_000, whatsapp_numbers: 4 },
  },
};

export const DEFAULT_PLAN: PlanId = "start";

export function isPlanId(value: unknown): value is PlanId {
  return typeof value === "string" && (PLAN_IDS as readonly string[]).includes(value);
}

export function isLimitKey(value: unknown): value is LimitKey {
  return typeof value === "string" && (LIMIT_KEYS as readonly string[]).includes(value);
}

export function isMonthlyLimit(key: LimitKey): key is MonthlyLimitKey {
  return (MONTHLY_LIMIT_KEYS as readonly string[]).includes(key);
}

/** Resolves a stored plan id; unknown or missing falls back to the default plan. */
export function getPlan(id: string | null | undefined): PlanDefinition {
  return isPlanId(id) ? PLANS[id] : PLANS[DEFAULT_PLAN];
}

export type LimitCheck =
  | { allowed: true; limit: number | null; used: number; remaining: number | null }
  | { allowed: false; limit: number; used: number; remaining: number; reason: "not_included" | "limit_reached" };

/** Can `amount` more units be consumed given `used` so far? */
export function checkLimit(plan: PlanDefinition, key: LimitKey, used: number, amount = 1): LimitCheck {
  if (!Number.isInteger(amount) || amount < 0) throw new RangeError("amount must be a non-negative integer");
  const safeUsed = Number.isFinite(used) ? Math.max(0, Math.floor(used)) : 0;
  const limit = plan.limits[key];
  if (limit === null) return { allowed: true, limit: null, used: safeUsed, remaining: null };
  const remaining = Math.max(0, limit - safeUsed);
  if (limit === 0 && amount > 0) return { allowed: false, limit, used: safeUsed, remaining: 0, reason: "not_included" };
  if (safeUsed + amount > limit) return { allowed: false, limit, used: safeUsed, remaining, reason: "limit_reached" };
  return { allowed: true, limit, used: safeUsed, remaining: remaining - amount };
}

export interface UsageItem {
  key: LimitKey;
  limit: number | null;
  used: number;
  /** 0-100, `null` when unlimited or not included. */
  percent: number | null;
}

export function summarizeUsage(plan: PlanDefinition, used: Partial<Record<LimitKey, number>>): UsageItem[] {
  return LIMIT_KEYS.map((key) => {
    const limit = plan.limits[key];
    const u = Math.max(0, Math.floor(used[key] ?? 0));
    const percent = limit === null || limit === 0 ? null : Math.min(100, Math.round((u / limit) * 100));
    return { key, limit, used: u, percent };
  });
}

/** Calendar-month bucket (`YYYY-MM`) of an instant in an IANA time zone (default UTC). */
export function usagePeriod(at: Date, timeZone = "UTC"): string {
  let tz = timeZone;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
  } catch {
    tz = "UTC";
  }
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit" }).formatToParts(at);
  const y = parts.find((p) => p.type === "year")?.value ?? "1970";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  return `${y}-${m}`;
}
