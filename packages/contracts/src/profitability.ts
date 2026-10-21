import { z } from "zod";
import { currencySchema, uuidSchema } from "./common.js";
import { metricsDaySchema } from "./metrics.js";

export const profitabilityGroupBySchema = z.enum(["customer", "order", "ad"]);
export type ProfitabilityGroupBy = z.infer<typeof profitabilityGroupBySchema>;

/** `to` is inclusive. `currency` defaults to the tenant currency; revenue is never mixed across currencies. */
export const profitabilityQuerySchema = z.object({
  from: metricsDaySchema.optional(),
  to: metricsDaySchema.optional(),
  currency: currencySchema.optional(),
  groupBy: profitabilityGroupBySchema.default("customer"),
});
export type ProfitabilityQuery = z.infer<typeof profitabilityQuerySchema>;

const minor = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
/** Margin can be negative. */
const signedMinor = z.number().int().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER);
const count = z.number().int().min(0);

/**
 * Costs of one row. `adSpendMinor` is in the report currency. AI, TTS and WhatsApp costs are in
 * `usageCostCurrency` (USD minor units); TTS and WhatsApp are estimates, ad spend is an
 * allocation (estimate) per customer/order.
 */
export const profitabilityCostsSchema = z.object({
  adSpendMinor: minor,
  aiCostMinor: minor,
  ttsCostMinor: minor,
  whatsappCostMinor: minor,
});

export const profitabilityRowSchema = profitabilityCostsSchema.extend({
  key: z.string(),
  label: z.string(),
  contactId: uuidSchema.nullable(),
  orderId: uuidSchema.nullable(),
  adSourceId: z.string().nullable(),
  revenueMinor: minor,
  /** revenue - ad spend - (usage costs only when the report currency equals usageCostCurrency). */
  marginMinor: signedMinor,
  conversations: count,
  /** revenue / ad spend in basis points (only groupBy=ad, null without spend). */
  roasBp: z.number().int().min(0).nullable(),
});
export type ProfitabilityRow = z.infer<typeof profitabilityRowSchema>;

export const unconvertedContactSchema = z.object({
  contactId: uuidSchema,
  label: z.string(),
  conversations: count,
  /** AI + TTS + WhatsApp, usageCostCurrency minor units (partly estimated). */
  usageCostMinor: minor,
});
export type UnconvertedContact = z.infer<typeof unconvertedContactSchema>;

export const profitabilitySchema = z.object({
  from: metricsDaySchema,
  to: metricsDaySchema,
  currency: currencySchema,
  groupBy: profitabilityGroupBySchema,
  usageCostCurrency: currencySchema,
  /** False when the report currency differs from usageCostCurrency: no FX, usage costs left out of margin. */
  usageCostsInMargin: z.boolean(),
  /** Currencies with verified revenue or ad spend, to switch the report currency. */
  currencies: z.array(currencySchema),
  whatsappRatesSource: z.enum(["tenant", "default"]),
  totals: profitabilityCostsSchema.extend({
    revenueMinor: minor,
    marginMinor: signedMinor,
    conversations: count,
    costPerConversationMinor: minor.nullable(),
    wonQuotes: count,
    costPerWonQuoteMinor: minor.nullable(),
  }),
  rows: z.array(profitabilityRowSchema),
  topCustomers: z.array(profitabilityRowSchema),
  bottomCustomers: z.array(profitabilityRowSchema),
  unconverted: z.array(unconvertedContactSchema),
});
export type Profitability = z.infer<typeof profitabilitySchema>;
