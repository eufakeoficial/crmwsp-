import { z } from "zod";
import { isoDateTimeSchema, uuidSchema } from "./common.js";

export const templateCategorySchema = z.enum(["marketing", "utility", "authentication"]);
export type TemplateCategory = z.infer<typeof templateCategorySchema>;

export const templateStatusSchema = z.enum(["approved", "pending", "rejected", "paused", "disabled"]);
export type TemplateStatus = z.infer<typeof templateStatusSchema>;

/** POST /channels/:id/templates. Name follows Meta's rule: lowercase letters, digits and underscores. */
export const submitTemplateRequestSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(512)
    .regex(/^[a-z0-9_]+$/, "lowercase letters, digits and underscores only"),
  /** Meta language code, e.g. `es`, `es_AR`, `en_US`. */
  language: z.string().trim().regex(/^[a-z]{2,3}(_[A-Z]{2})?$/, "invalid language code"),
  category: templateCategorySchema,
  /** Body text with `{{1}}`, `{{2}}` placeholders. */
  body: z.string().trim().min(1).max(1024),
  /** Sample body with the placeholders filled in; Meta requires it when the body has variables. */
  example: z.string().trim().min(1).max(1024).optional(),
}).refine((v) => !/\{\{\s*\d+\s*\}\}/.test(v.body) || v.example !== undefined, {
  message: "example is required when the body has variables",
  path: ["example"],
});
export type SubmitTemplateRequest = z.infer<typeof submitTemplateRequestSchema>;

export const messageTemplateSchema = z.object({
  id: uuidSchema,
  channelConnectionId: uuidSchema,
  name: z.string(),
  language: z.string(),
  category: templateCategorySchema,
  status: templateStatusSchema,
  body: z.string(),
  externalId: z.string().nullable(),
  syncedAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type MessageTemplateDto = z.infer<typeof messageTemplateSchema>;

/** Queue name of the periodic template status sync (apps/worker). */
export const TEMPLATE_SYNC_QUEUE_NAME = "template-sync";
