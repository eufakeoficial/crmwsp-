import { z } from "zod";
import { agentConfigSchema } from "./ai-settings.js";

/*
 * Contracts of the sales-bot template gallery (static, versioned presets).
 * `GET /bot-templates` lists them; `POST /bot-templates/:id/apply` copies one into the tenant's
 * active agent config (`/ai/agent-config`) and never overwrites a non-empty prompt without
 * `overwrite: true`.
 */

export const BOT_TEMPLATE_INDUSTRIES = ["health", "home", "events", "retail", "education", "real_estate"] as const;
export const botTemplateIndustrySchema = z.enum(BOT_TEMPLATE_INDUSTRIES);
export type BotTemplateIndustry = z.infer<typeof botTemplateIndustrySchema>;

export const botTemplateSchema = z.object({
  id: z.string().min(1).max(64),
  /** Bumped whenever the preset content changes. */
  version: z.number().int().positive(),
  name: z.string().min(1).max(120),
  description: z.string().min(1).max(500),
  industry: botTemplateIndustrySchema,
  /** Persona, tone and rules; becomes the base of the agent system prompt. */
  prompt: z.string().min(1).max(8_000),
  quickReplies: z.array(z.string().min(1).max(120)).min(1).max(10),
  followUps: z.array(z.string().min(1).max(240)).min(1).max(10),
});
export type BotTemplate = z.infer<typeof botTemplateSchema>;

export const botTemplateListSchema = z.object({ items: z.array(botTemplateSchema) });
export type BotTemplateList = z.infer<typeof botTemplateListSchema>;

/** Body of `POST /bot-templates/:id/apply`. */
export const applyBotTemplateRequestSchema = z.object({ overwrite: z.boolean().optional() });
export type ApplyBotTemplateRequest = z.infer<typeof applyBotTemplateRequestSchema>;

/** Response of apply: the resulting active agent config plus the template that was applied. */
export const applyBotTemplateResponseSchema = z.object({
  templateId: z.string(),
  templateVersion: z.number().int().positive(),
  agentConfig: agentConfigSchema,
});
export type ApplyBotTemplateResponse = z.infer<typeof applyBotTemplateResponseSchema>;
