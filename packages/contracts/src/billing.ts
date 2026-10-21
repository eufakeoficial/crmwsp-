import { z } from "zod";

export const planLimitKeySchema = z.enum(["ai_messages", "contacts", "seats", "broadcast_sends", "whatsapp_numbers"]);
export type PlanLimitKeyDto = z.infer<typeof planLimitKeySchema>;

/** `GET /billing/plan`. `limit: null` = unlimited, `0` = not included in the plan. */
export const billingPlanResponseSchema = z.object({
  plan: z.object({
    id: z.enum(["start", "pro"]),
    name: z.string(),
    priceMonthlyUsd: z.number(),
    priceAnnualUsd: z.number(),
  }),
  /** `YYYY-MM` in the tenant time zone; monthly limits reset at its end. */
  period: z.string(),
  usage: z.array(
    z.object({
      key: planLimitKeySchema,
      monthly: z.boolean(),
      limit: z.number().int().nullable(),
      used: z.number().int(),
      percent: z.number().int().nullable(),
    }),
  ),
  /** No payment provider charges the subscription yet. */
  billingProvider: z.literal("none"),
});
export type BillingPlanResponse = z.infer<typeof billingPlanResponseSchema>;
