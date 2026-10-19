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
});
export type CreateGupshupChannelRequest = z.infer<typeof createGupshupChannelRequestSchema>;

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
