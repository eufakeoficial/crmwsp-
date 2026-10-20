import {
  FILTER_FIELDS,
  filterFieldDef,
  type ContactSegment,
  type ContactTagCount,
  type FilterCondition,
  type FilterFieldGroup,
  type FilterFieldType,
  type MoneyFilterValue,
  type RelativeTime,
} from "@crmwsp/contracts";
import { formatMoneyMinor, majorToMinor, minorToMajor } from "../../lib/format";

/** Currencies offered in the money filter; the tenant currency always comes first. */
const COMMON_CURRENCIES = ["USD", "EUR", "CLP", "COP", "PYG", "PEN", "BOB", "MXN", "ARS", "BRL", "UYU"];
export function moneyCurrencies(tenantCurrency: string): string[] {
  return [...new Set([tenantCurrency, ...COMMON_CURRENCIES])];
}

/** Typed amount ("12,50") in `currency` to the filter value, using the currency's exponent. */
export function toMoneyFilterValue(input: string, currency: string): MoneyFilterValue | undefined {
  const amountMinor = majorToMinor(input, currency);
  return amountMinor === undefined ? undefined : { amountMinor, currency };
}

/** Filter value back to the text shown in the amount input. */
export function moneyInputText(value: MoneyFilterValue): string {
  return String(minorToMajor(value.amountMinor, value.currency));
}

export const GROUP_LABELS: Record<FilterFieldGroup, string> = {
  general: "General",
  system: "Sistema",
  sales: "Ventas",
  custom: "Personalizados",
};

export const OPERATOR_LABELS: Record<FilterFieldType, Record<string, string>> = {
  text: {
    is: "es",
    is_not: "no es",
    has_any: "tiene valor",
    contains: "contiene",
    not_contains: "no contiene",
    starts_with: "empieza por",
    is_unknown: "está vacío",
  },
  date: {
    after: "después del",
    before: "antes del",
    on: "el día",
    has_any: "tiene valor",
    is_unknown: "está vacío",
    less_than_ago: "hace menos de",
    more_than_ago: "hace más de",
  },
  number: { eq: "igual a", neq: "distinto de", gt: "mayor que", lt: "menor que", has_any: "mayor que 0", is_unknown: "es 0" },
  relation: { is: "es", is_not: "no es" },
};

export const UNIT_LABELS: Record<RelativeTime["unit"], string> = { minutes: "minutos", hours: "horas", days: "días" };

export const NO_VALUE = new Set(["has_any", "is_unknown"]);

export const FIELDS_BY_GROUP = (["general", "system", "sales"] as const).map((g) => ({
  group: g,
  fields: FILTER_FIELDS.filter((f) => f.group === g),
}));

export function fieldLabel(key: string): string {
  return filterFieldDef(key)?.label ?? key;
}

/** Human summary of a condition for its chip. */
export function describeCondition(c: FilterCondition, ctx: { segments: readonly ContactSegment[] }): string {
  const def = filterFieldDef(c.field);
  const op = OPERATOR_LABELS[c.type][c.operator] ?? c.operator;
  const label = def?.label ?? c.field;
  if (NO_VALUE.has(c.operator)) return `${label} ${op}`;
  let value: string;
  if (c.type === "relation") {
    const vals = (c.value as string[]) ?? [];
    value = vals
      .map((v) =>
        c.field === "segment" ? (ctx.segments.find((s) => s.id === v)?.name ?? "segmento") : (def?.options?.find((o) => o.value === v)?.label ?? v),
      )
      .join(", ");
  } else if (c.operator === "less_than_ago" || c.operator === "more_than_ago") {
    const r = c.value as RelativeTime;
    value = `${r.amount} ${UNIT_LABELS[r.unit]}`;
  } else if (c.type === "number" && def?.money) {
    const m = c.value as MoneyFilterValue;
    value = formatMoneyMinor(m.amountMinor, m.currency);
  } else value = String(c.value);
  return `${label} ${op} ${value}`;
}

export interface RelationChoice {
  value: string;
  label: string;
  count?: number;
}

export function relationChoices(field: string, tags: readonly ContactTagCount[], segments: readonly ContactSegment[]): RelationChoice[] {
  if (field === "tag") return tags.map((t) => ({ value: t.tag, label: t.tag, count: t.count }));
  if (field === "segment") return segments.map((s) => ({ value: s.id, label: s.name, count: s.count }));
  return (filterFieldDef(field)?.options ?? []).map((o) => ({ value: o.value, label: o.label }));
}
