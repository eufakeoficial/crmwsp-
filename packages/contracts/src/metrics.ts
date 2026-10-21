import { z } from "zod";
import { currencySchema, uuidSchema } from "./common.js";

/** Calendar day in the tenant's time zone, `YYYY-MM-DD`. */
export const metricsDaySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

export const MAX_METRICS_RANGE_DAYS = 366;

/** `to` is inclusive. Both optional: the server defaults to the last 30 days. */
export const salesMetricsQuerySchema = z.object({
  from: metricsDaySchema.optional(),
  to: metricsDaySchema.optional(),
});
export type SalesMetricsQuery = z.infer<typeof salesMetricsQuerySchema>;

const count = z.number().int().min(0);
const moneyMinor = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

/** Revenue is never summed across currencies. */
export const currencyAmountSchema = z.object({ currency: currencySchema, amountMinor: moneyMinor });
export type CurrencyAmount = z.infer<typeof currencyAmountSchema>;

export const metricsOrderStatusSchema = z.enum([
  "draft",
  "pending_payment",
  "paid",
  "fulfilled",
  "shipped",
  "delivered",
  "cancelled",
  "refunded",
]);

export const salesMetricsDaySchema = z.object({
  date: metricsDaySchema,
  newConversations: count,
  newLeads: count,
  buyers: count,
  aiConversations: count,
  humanConversations: count,
  revenue: z.array(currencyAmountSchema),
});
export type SalesMetricsDay = z.infer<typeof salesMetricsDaySchema>;

export const topProductSchema = z.object({
  productId: uuidSchema.nullable(),
  name: z.string(),
  currency: currencySchema,
  quantity: count,
  revenueMinor: moneyMinor,
});
export type TopProduct = z.infer<typeof topProductSchema>;

export const salesMetricsSchema = z.object({
  from: metricsDaySchema,
  to: metricsDaySchema,
  totals: z.object({
    newConversations: count,
    newLeads: count,
    /** Distinct contacts with an order paid in the range. */
    buyers: count,
    /** buyers / newLeads in basis points (1234 = 12.34%); null when there are no new leads. */
    conversionBp: z.number().int().min(0).nullable(),
    aiConversations: count,
    humanConversations: count,
    revenue: z.array(currencyAmountSchema),
    /** Orders created in the range, per status (absent statuses are 0). */
    ordersByStatus: z.record(metricsOrderStatusSchema, count),
  }),
  daily: z.array(salesMetricsDaySchema),
  topProducts: z.array(topProductSchema),
  winningProduct: topProductSchema.nullable(),
});
export type SalesMetrics = z.infer<typeof salesMetricsSchema>;
