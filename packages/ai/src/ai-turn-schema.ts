import { z } from "zod";
import { AI_CLAIM_KINDS, aiTurnOutputSchema } from "@crmwsp/contracts";
import type { AiTurnOutput } from "@crmwsp/contracts";
import type { ResponseFormat } from "./provider/types.js";

/*
 * OpenAI strict `json_schema` requires every property to be listed in `required` and
 * `additionalProperties: false` at every object level, so optional fields cannot be
 * expressed. They are sent as nullable here and `normalizeAiTurnOutput` maps
 * `null → absent` before `aiTurnOutputSchema` (the contract) validates the result.
 */

type JsonSchema = Record<string, unknown>;
const str: JsonSchema = { type: "string" };
const num: JsonSchema = { type: "number" };
const nullable = (s: JsonSchema): JsonSchema => ({ anyOf: [s, { type: "null" }] });
const obj = (properties: Record<string, JsonSchema>): JsonSchema => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const action = (type: string, props: Record<string, JsonSchema>): JsonSchema =>
  obj({ type: { type: "string", enum: [type] }, ...props });

export const aiTurnJsonSchema: JsonSchema = obj({
  reply: nullable(
    obj({
      text: str,
      claims: {
        type: "array",
        items: obj({
          kind: { type: "string", enum: [...AI_CLAIM_KINDS] },
          text: str,
          citations: { type: "array", items: obj({ chunkId: str }) },
        }),
      },
    }),
  ),
  actions: {
    type: "array",
    items: {
      anyOf: [
        action("update_contact_field", { field: str, value: str, confidence: num, sourceMessageId: str }),
        action("create_task", { title: str, dueAt: nullable(str) }),
        action("move_stage", { stage: str }),
        action("create_quote_draft", { items: { type: "array", items: obj({ chunkId: str, quantity: num }) } }),
        action("apply_discount", { percent: num }),
        action("send_template", { templateName: str }),
        action("handoff", { reason: str }),
      ],
    },
  },
  confidence: num,
  needsHuman: { type: "boolean" },
  reason: str,
});

/** Converts the strict-mode shape (nullable) into the contract shape (optional). */
export function normalizeAiTurnOutput(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return raw;
  const out: Record<string, unknown> = { ...(raw as Record<string, unknown>) };
  if (out.reply === null) delete out.reply;
  if (Array.isArray(out.actions)) {
    out.actions = out.actions.map((a: unknown) => {
      if (typeof a !== "object" || a === null || Array.isArray(a)) return a;
      const copy: Record<string, unknown> = { ...(a as Record<string, unknown>) };
      if (copy.type === "create_task" && copy.dueAt === null) delete copy.dueAt;
      return copy;
    });
  }
  return out;
}

/** Zod schema accepting the strict-mode output and yielding a contract `AiTurnOutput`. */
export const aiTurnStrictOutputSchema: z.ZodType<AiTurnOutput> = z.unknown().transform(normalizeAiTurnOutput).pipe(aiTurnOutputSchema);

/** Ready-to-use `responseFormat` for the AI turn. */
export const aiTurnResponseFormat: ResponseFormat<AiTurnOutput> = {
  name: "ai_turn",
  jsonSchema: aiTurnJsonSchema,
  schema: aiTurnStrictOutputSchema,
};
