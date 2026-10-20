import { z } from "zod";
import { isoDateTimeSchema, uuidSchema } from "./common.js";
import { contactBookItemSchema, contactTagSchema } from "./contacts.js";

/**
 * ManyChat-style contact filter. The client only sends registry keys (never column names); the API
 * compiles each condition into a parameterized SQL predicate.
 */

export const filterFieldTypeSchema = z.enum(["text", "date", "number", "relation"]);
export type FilterFieldType = z.infer<typeof filterFieldTypeSchema>;

/** Operators depend only on the field type. */
export const FILTER_OPERATORS = {
  text: ["is", "is_not", "has_any", "contains", "not_contains", "starts_with", "is_unknown"],
  date: ["after", "before", "on", "has_any", "is_unknown", "less_than_ago", "more_than_ago"],
  number: ["eq", "neq", "gt", "lt", "has_any", "is_unknown"],
  relation: ["is", "is_not"],
} as const satisfies Record<FilterFieldType, readonly string[]>;
export type FilterOperator = (typeof FILTER_OPERATORS)[FilterFieldType][number];

export const filterFieldGroupSchema = z.enum(["general", "system", "sales", "custom"]);
export type FilterFieldGroup = z.infer<typeof filterFieldGroupSchema>;

export interface FilterFieldOption {
  value: string;
  label: string;
}

export interface FilterFieldDef {
  key: string;
  group: FilterFieldGroup;
  type: FilterFieldType;
  label: string;
  /** Closed value set for relation fields; tag/segment values are dynamic (names / ids). */
  options?: readonly FilterFieldOption[];
  /** Number fields stored in minor units (shown as major in the UI). */
  minorUnits?: boolean;
}

const YES_NO: readonly FilterFieldOption[] = [
  { value: "yes", label: "Sí" },
  { value: "no", label: "No" },
];

/** Server-side allowlist of filterable fields. */
export const FILTER_FIELDS: readonly FilterFieldDef[] = [
  { key: "tag", group: "general", type: "relation", label: "Etiqueta" },
  {
    key: "marketing_consent",
    group: "general",
    type: "relation",
    label: "Consentimiento de marketing",
    options: [
      { value: "granted", label: "Aceptado" },
      { value: "revoked", label: "Revocado" },
      { value: "none", label: "Sin respuesta" },
    ],
  },
  {
    key: "source",
    group: "general",
    type: "relation",
    label: "Origen",
    options: [
      { value: "ad", label: "Anuncio" },
      { value: "organic", label: "Orgánico" },
      { value: "api", label: "API" },
      { value: "import", label: "Importación" },
    ],
  },
  { key: "segment", group: "general", type: "relation", label: "Segmento" },
  { key: "name", group: "system", type: "text", label: "Nombre" },
  { key: "phone", group: "system", type: "text", label: "Teléfono" },
  { key: "created_at", group: "system", type: "date", label: "Fecha de alta" },
  { key: "last_inbound_at", group: "system", type: "date", label: "Último mensaje recibido" },
  { key: "last_message_at", group: "system", type: "date", label: "Último mensaje" },
  {
    key: "window_open",
    group: "system",
    type: "relation",
    label: "Ventana de 24 h",
    options: [
      { value: "open", label: "Abierta" },
      { value: "closed", label: "Cerrada" },
    ],
  },
  { key: "has_open_quote", group: "sales", type: "relation", label: "Tiene presupuesto abierto", options: YES_NO },
  { key: "has_paid_order", group: "sales", type: "relation", label: "Tiene pedido pagado", options: YES_NO },
  { key: "total_paid", group: "sales", type: "number", label: "Total pagado", minorUnits: true },
  { key: "last_order_at", group: "sales", type: "date", label: "Último pedido" },
  { key: "ad_id", group: "sales", type: "text", label: "ID de anuncio" },
];

/** Custom fields live in `contacts.extracted` and are addressed as `cf:<key>` (always text). */
export const CUSTOM_FIELD_PATTERN = /^cf:[a-z0-9_]{1,40}$/;

export function filterFieldDef(key: string): FilterFieldDef | undefined {
  const known = FILTER_FIELDS.find((f) => f.key === key);
  if (known) return known;
  if (CUSTOM_FIELD_PATTERN.test(key)) return { key, group: "custom", type: "text", label: key.slice(3) };
  return undefined;
}

export const FILTER_MAX_CONDITIONS = 20;
export const FILTER_MAX_TEXT = 200;
export const FILTER_MAX_RELATION_VALUES = 100;

export const relativeTimeSchema = z.object({
  amount: z.number().int().min(1).max(100_000),
  unit: z.enum(["minutes", "hours", "days"]),
});
export type RelativeTime = z.infer<typeof relativeTimeSchema>;

const textValue = z.string().trim().min(1).max(FILTER_MAX_TEXT);
const dateValue = z.union([z.iso.date(), isoDateTimeSchema]);
const numberValue = z.number().finite().min(-1e15).max(1e15);
const relationValue = z.array(z.string().trim().min(1).max(100)).min(1).max(FILTER_MAX_RELATION_VALUES);

const NO_VALUE_OPERATORS = new Set(["has_any", "is_unknown"]);

function valueSchemaFor(type: FilterFieldType, operator: string): z.ZodType | null {
  if (NO_VALUE_OPERATORS.has(operator)) return null;
  switch (type) {
    case "text":
      return textValue;
    case "date":
      return operator === "less_than_ago" || operator === "more_than_ago" ? relativeTimeSchema : dateValue;
    case "number":
      return numberValue;
    case "relation":
      return relationValue;
  }
}

export const filterConditionSchema = z
  .object({
    field: z.string().min(1).max(64),
    type: filterFieldTypeSchema,
    operator: z.string().min(1).max(20),
    value: z.unknown().optional(),
  })
  .superRefine((c, ctx) => {
    const def = filterFieldDef(c.field);
    if (!def) return ctx.addIssue({ code: "custom", path: ["field"], message: "unknown field" });
    if (def.type !== c.type) return ctx.addIssue({ code: "custom", path: ["type"], message: "type does not match field" });
    if (!(FILTER_OPERATORS[c.type] as readonly string[]).includes(c.operator)) {
      return ctx.addIssue({ code: "custom", path: ["operator"], message: "operator not allowed for type" });
    }
    const schema = valueSchemaFor(c.type, c.operator);
    if (!schema) return;
    const parsed = schema.safeParse(c.value);
    if (!parsed.success) return ctx.addIssue({ code: "custom", path: ["value"], message: "invalid value" });
    if (def.key === "segment" && !(parsed.data as string[]).every((v) => uuidSchema.safeParse(v).success)) {
      return ctx.addIssue({ code: "custom", path: ["value"], message: "segment ids must be uuids" });
    }
    if (def.options && !(parsed.data as string[]).every((v) => def.options!.some((o) => o.value === v))) {
      ctx.addIssue({ code: "custom", path: ["value"], message: "value not allowed for field" });
    }
  });
export type FilterCondition = z.infer<typeof filterConditionSchema>;

export const contactFilterSchema = z.object({
  match: z.enum(["all", "any"]).default("all"),
  conditions: z.array(filterConditionSchema).max(FILTER_MAX_CONDITIONS).default([]),
});
export type ContactFilter = z.infer<typeof contactFilterSchema>;

export const EMPTY_CONTACT_FILTER: ContactFilter = { match: "all", conditions: [] };

export const searchContactBookRequestSchema = z.object({
  filter: contactFilterSchema.default(EMPTY_CONTACT_FILTER),
  q: z.string().trim().max(100).optional(),
  cursor: z.string().min(1).max(200).optional(),
  limit: z.number().int().min(1).max(100).default(25),
});
export type SearchContactBookRequest = z.input<typeof searchContactBookRequestSchema>;

export const contactBookSearchResultSchema = z.object({
  items: z.array(contactBookItemSchema),
  nextCursor: z.string().nullable(),
  total: z.number().int(),
});
export type ContactBookSearchResult = z.infer<typeof contactBookSearchResultSchema>;

/** Tag with how many contacts carry it (sidebar). */
export const contactTagCountSchema = z.object({ tag: z.string(), count: z.number().int() });
export const contactTagCountsSchema = z.object({ items: z.array(contactTagCountSchema) });
export type ContactTagCount = z.infer<typeof contactTagCountSchema>;

// Segments

export const contactSegmentSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  filter: contactFilterSchema,
  /** Live count of contacts matching the filter right now. */
  count: z.number().int(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type ContactSegment = z.infer<typeof contactSegmentSchema>;

export const contactSegmentListSchema = z.object({ items: z.array(contactSegmentSchema) });

export const createContactSegmentRequestSchema = z.object({
  name: z.string().trim().min(1).max(80),
  filter: contactFilterSchema,
});
export type CreateContactSegmentRequest = z.input<typeof createContactSegmentRequestSchema>;

export const updateContactSegmentRequestSchema = createContactSegmentRequestSchema.partial();
export type UpdateContactSegmentRequest = z.input<typeof updateContactSegmentRequestSchema>;

// Bulk actions

export const BULK_MAX_ROWS = 10_000;

export const bulkSelectionSchema = z.union([
  z.object({ ids: z.array(uuidSchema).min(1).max(BULK_MAX_ROWS) }).strict(),
  z.object({ filter: contactFilterSchema, q: z.string().trim().max(100).optional() }).strict(),
]);
export type BulkSelection = z.input<typeof bulkSelectionSchema>;

export const contactBulkRequestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("add_tag"), selection: bulkSelectionSchema, tag: contactTagSchema }),
  z.object({ action: z.literal("remove_tag"), selection: bulkSelectionSchema, tag: contactTagSchema }),
  z.object({ action: z.literal("set_marketing_consent"), selection: bulkSelectionSchema, granted: z.boolean() }),
]);
export type ContactBulkRequest = z.input<typeof contactBulkRequestSchema>;

export const contactBulkResultSchema = z.object({ matched: z.number().int(), updated: z.number().int() });
export type ContactBulkResult = z.infer<typeof contactBulkResultSchema>;
