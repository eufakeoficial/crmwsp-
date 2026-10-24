import { z } from "zod";
import { e164PhoneSchema, isoDateTimeSchema, uuidSchema } from "./common.js";

export const channelProviderSchema = z.enum(["gupshup", "360dialog"]);
export type ChannelProvider = z.infer<typeof channelProviderSchema>;

export const channelStatusSchema = z.enum(["pending", "active", "disabled"]);
export type ChannelStatus = z.infer<typeof channelStatusSchema>;

/** POST /channels/gupshup. The apiKey is write-only: it is never returned. */
export const createGupshupChannelRequestSchema = z.object({
  phoneE164: e164PhoneSchema,
  appName: z.string().trim().min(1).max(100),
  apiKey: z.string().trim().min(8).max(512),
  /** Gupshup Partner API app id + app token (template submission/sync). Both or neither. */
  gupshupAppId: z.string().trim().min(1).max(128).optional(),
  partnerToken: z.string().trim().min(8).max(1024).optional(),
}).refine((v) => (v.gupshupAppId === undefined) === (v.partnerToken === undefined), {
  message: "gupshupAppId and partnerToken must be provided together",
  path: ["partnerToken"],
});

/** PUT /channels/:id/partner-credentials. The token is write-only: it is never returned. */
export const setPartnerCredentialsRequestSchema = z.object({
  gupshupAppId: z.string().trim().min(1).max(128),
  partnerToken: z.string().trim().min(8).max(1024),
});
export type SetPartnerCredentialsRequest = z.infer<typeof setPartnerCredentialsRequestSchema>;

/** AAD purpose of the encrypted Gupshup Partner app token (shared by apps/api and apps/worker). */
export const GUPSHUP_PARTNER_TOKEN_PURPOSE = "gupshup_partner_token";
export type CreateGupshupChannelRequest = z.infer<typeof createGupshupChannelRequestSchema>;

/**
 * POST /channels/360dialog/connect: the 360dialog Connect (Embedded Signup, Coexistence) redirect gives
 * a client id and the connected channel ids. `phoneE164` is only needed when the Hub does not expose it.
 */
export const connect360dialogRequestSchema = z.object({
  clientId: z.string().trim().min(1).max(128).optional(),
  channelIds: z.array(z.string().trim().regex(/^[A-Za-z0-9_-]{1,128}$/)).min(1).max(10),
  phoneE164: e164PhoneSchema.optional(),
});
export type Connect360dialogRequest = z.infer<typeof connect360dialogRequestSchema>;

/** GET /channels/360dialog/config: lets the web app build the Connect URL without baking the partner id in. */
export const dialog360ConfigSchema = z.object({ partnerId: z.string().nullable() });
export type Dialog360Config = z.infer<typeof dialog360ConfigSchema>;

export const channelSchema = z.object({
  id: uuidSchema,
  provider: channelProviderSchema,
  phoneE164: z.string(),
  appName: z.string().nullable(),
  status: channelStatusSchema,
  /** Callback URL to paste in the BSP console. Only returned to owner/admin. */
  webhookUrl: z.string().nullable(),
  /** Masked API key ("••••abcd"); null when it cannot be shown. */
  apiKeyHint: z.string().nullable(),
  /** Partner API app id; only returned to owner/admin. */
  gupshupAppId: z.string().nullable().optional(),
  /** True when a Partner app token is stored (templates can be submitted/synced). */
  partnerConfigured: z.boolean().optional(),
  /** Number quality reported by Meta (ADR 0021); null = never reported (BSP may not forward it). */
  qualityRating: z.enum(["GREEN", "YELLOW", "RED", "UNKNOWN"]).nullable().optional(),
  accountStatus: z.enum(["ok", "flagged", "restricted", "disabled"]).optional(),
  messagingLimit: z.string().nullable().optional(),
  qualityUpdatedAt: isoDateTimeSchema.nullable().optional(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type Channel = z.infer<typeof channelSchema>;

export const channelListResponseSchema = z.object({ items: z.array(channelSchema) });
export type ChannelListResponse = z.infer<typeof channelListResponseSchema>;

export const updateChannelRequestSchema = z.object({
  status: z.enum(["active", "disabled"]),
});
export type UpdateChannelRequest = z.infer<typeof updateChannelRequestSchema>;
