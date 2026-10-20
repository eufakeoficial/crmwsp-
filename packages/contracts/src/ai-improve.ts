import { z } from "zod";

/** Composer "Mejorar texto": rewrites a draft. Never sends anything. */
export const improveTextStyleSchema = z.enum(["professional", "friendly", "shorter"]);
export type ImproveTextStyle = z.infer<typeof improveTextStyleSchema>;

export const improveTextRequestSchema = z.object({
  text: z.string().trim().min(1).max(4096),
  style: improveTextStyleSchema,
});
export type ImproveTextRequest = z.infer<typeof improveTextRequestSchema>;

export const improveTextResponseSchema = z.object({ text: z.string() });
export type ImproveTextResponse = z.infer<typeof improveTextResponseSchema>;
