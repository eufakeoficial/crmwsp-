import { z } from "zod";

/** Verticals accepted by the Gupshup Partner API (`vertical` field). */
export const WHATSAPP_PROFILE_VERTICALS = [
  "OTHER", "AUTO", "BEAUTY", "APPAREL", "EDU", "ENTERTAIN", "EVENT_PLAN", "FINANCE", "GROCERY",
  "GOVT", "HOTEL", "HEALTH", "NONPROFIT", "PROF_SERVICES", "RETAIL", "TRAVEL", "RESTAURANT",
] as const;
export const whatsappProfileVerticalSchema = z.enum(WHATSAPP_PROFILE_VERTICALS);
export type WhatsappProfileVertical = z.infer<typeof whatsappProfileVerticalSchema>;

/** Max photo upload (jpg/png). */
export const WHATSAPP_PROFILE_PHOTO_MAX_BYTES = 5 * 1024 * 1024;
export const WHATSAPP_PROFILE_ABOUT_MAX = 512;

const optionalText = (max: number) => z.string().trim().max(max).optional();
const httpUrl = z
  .string()
  .trim()
  .max(256)
  .url()
  .refine((v) => /^https?:\/\//i.test(v), "Must start with http:// or https://");

/** GET /whatsapp-profile/:channelId. */
export const whatsappProfileSchema = z.object({
  about: z.string().nullable(),
  description: z.string().nullable(),
  address: z.string().nullable(),
  email: z.string().nullable(),
  website1: z.string().nullable(),
  website2: z.string().nullable(),
  vertical: z.string().nullable(),
  photoUrl: z.string().nullable(),
});
export type WhatsappProfile = z.infer<typeof whatsappProfileSchema>;

/** PUT /whatsapp-profile/:channelId. Only the provided fields are changed. */
export const updateWhatsappProfileRequestSchema = z
  .object({
    about: optionalText(WHATSAPP_PROFILE_ABOUT_MAX),
    description: optionalText(512),
    address: optionalText(256),
    email: z.string().trim().max(128).email().optional(),
    website1: httpUrl.optional(),
    website2: httpUrl.optional(),
    vertical: whatsappProfileVerticalSchema.optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: "Provide at least one field" });
export type UpdateWhatsappProfileRequest = z.infer<typeof updateWhatsappProfileRequestSchema>;

/**
 * POST /whatsapp-profile/:channelId/display-name. Mirrors Gupshup's rules: 3-249 chars, letters, digits,
 * spaces, hyphens, underscores and parentheses, not all uppercase.
 */
export const requestDisplayNameRequestSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(3)
    .max(249)
    .regex(/^[\p{L}\p{N} _()-]+$/u, "Only letters, numbers, spaces, hyphens, underscores and parentheses")
    .refine((v) => !(v === v.toUpperCase() && v !== v.toLowerCase() && !/\p{N}/u.test(v)), "Must not be all uppercase"),
});
export type RequestDisplayNameRequest = z.infer<typeof requestDisplayNameRequestSchema>;

export const whatsappProfileActionResponseSchema = z.object({ status: z.literal("ok") });
export type WhatsappProfileActionResponse = z.infer<typeof whatsappProfileActionResponseSchema>;
