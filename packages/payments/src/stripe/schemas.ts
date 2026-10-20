import { z } from "zod";

export const sessionSchema = z.object({
  id: z.string(),
  object: z.literal("checkout.session").optional(),
  amount_total: z.number().int().nullable().optional(),
  currency: z.string().nullable().optional(),
  payment_status: z.string().optional(),
  status: z.string().nullable().optional(),
  client_reference_id: z.string().nullable().optional(),
  metadata: z.record(z.string(), z.string()).nullable().optional(),
  payment_intent: z.string().nullable().optional(),
});
export type StripeSession = z.infer<typeof sessionSchema>;

export const chargeSchema = z.object({
  id: z.string(),
  amount: z.number().int(),
  amount_refunded: z.number().int(),
  currency: z.string(),
  refunded: z.boolean().optional(),
  payment_intent: z.string().nullable().optional(),
  metadata: z.record(z.string(), z.string()).nullable().optional(),
});

export const eventSchema = z.object({
  id: z.string().min(1),
  type: z.string(),
  created: z.number().int(),
  data: z.object({ object: z.unknown() }),
});

export const createSessionResponseSchema = z.object({
  id: z.string().regex(/^cs_[A-Za-z0-9_]+$/),
  url: z.url(),
  expires_at: z.number().int().nullable().optional(),
});

export const errorBodySchema = z.object({
  error: z.object({ code: z.string().optional() }).optional(),
});
