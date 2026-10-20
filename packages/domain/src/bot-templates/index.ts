import type { BotTemplate } from "@crmwsp/contracts";
import { BOT_TEMPLATES } from "./data.js";

export { BOT_TEMPLATES } from "./data.js";

export function listBotTemplates(): readonly BotTemplate[] {
  return BOT_TEMPLATES;
}

export function getBotTemplate(id: string): BotTemplate | undefined {
  return BOT_TEMPLATES.find((t) => t.id === id);
}

/**
 * Builds the agent system prompt from a preset. The agent config has no dedicated fields for
 * quick replies or follow-ups, so they are appended as clearly labelled sections the owner can edit.
 */
export function composeTemplatePrompt(t: BotTemplate): string {
  return [
    t.prompt.trim(),
    "",
    "Respuestas rápidas sugeridas:",
    ...t.quickReplies.map((q) => `- ${q}`),
    "",
    "Seguimientos sugeridos (si el cliente no responde):",
    ...t.followUps.map((f) => `- ${f}`),
  ].join("\n");
}
