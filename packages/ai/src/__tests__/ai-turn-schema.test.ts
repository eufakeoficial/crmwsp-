import { describe, expect, it } from "vitest";
import { AI_ACTION_TYPES, aiTurnOutputSchema } from "@crmwsp/contracts";
import { aiTurnJsonSchema, aiTurnResponseFormat, normalizeAiTurnOutput } from "../ai-turn-schema.js";
import { OpenAICompatibleProvider } from "../provider/openai-compatible.js";
import { API_KEY, chatBody, json, mockFetch, publicLookup } from "./helpers.js";

/** Walks a JSON Schema and returns every OpenAI strict-mode violation found. */
function strictViolations(node: unknown, path = "$"): string[] {
  if (typeof node !== "object" || node === null) return [];
  const s = node as Record<string, unknown>;
  const out: string[] = [];
  if (s.type === "object") {
    const props = (s.properties ?? {}) as Record<string, unknown>;
    const req = (s.required ?? []) as string[];
    if (s.additionalProperties !== false) out.push(`${path}: additionalProperties must be false`);
    for (const k of Object.keys(props)) if (!req.includes(k)) out.push(`${path}.${k}: not in required`);
    for (const r of req) if (!(r in props)) out.push(`${path}: required '${r}' has no property`);
    for (const [k, v] of Object.entries(props)) out.push(...strictViolations(v, `${path}.${k}`));
  }
  if (s.items) out.push(...strictViolations(s.items, `${path}[]`));
  for (const key of ["anyOf"] as const) {
    if (Array.isArray(s[key])) (s[key] as unknown[]).forEach((x, i) => out.push(...strictViolations(x, `${path}.${key}${i}`)));
  }
  for (const banned of ["oneOf", "allOf", "not", "$ref", "patternProperties"]) if (banned in s) out.push(`${path}: ${banned} unsupported`);
  return out;
}

const strictSample = {
  reply: null,
  actions: [
    { type: "create_task", title: "Llamar", dueAt: null },
    { type: "create_task", title: "Visitar", dueAt: "2026-10-21T10:00:00Z" },
    { type: "handoff", reason: "x" },
  ],
  confidence: 0.8,
  needsHuman: false,
  reason: "r",
};

describe("aiTurnJsonSchema", () => {
  it("satisfies strict json_schema rules at every level", () => {
    expect(strictViolations(aiTurnJsonSchema)).toEqual([]);
  });
  it("covers every contract action type", () => {
    type Variant = { properties: { type: { enum: string[] } } };
    const props = aiTurnJsonSchema.properties as { actions: { items: { anyOf: Variant[] } } };
    expect(props.actions.items.anyOf.map((a) => a.properties.type.enum[0]).sort()).toEqual([...AI_ACTION_TYPES].sort());
  });
});

describe("normalizeAiTurnOutput", () => {
  it("maps nullable fields to absent and yields a valid AiTurnOutput", () => {
    const n = normalizeAiTurnOutput(strictSample) as { actions: object[] };
    expect("reply" in n).toBe(false);
    expect("dueAt" in n.actions[0]!).toBe(false);
    expect(aiTurnOutputSchema.safeParse(n).success).toBe(true);
  });
  it("keeps a non-null reply", () => {
    const r = aiTurnResponseFormat.schema.parse({ ...strictSample, reply: { text: "Hola", claims: [] } });
    expect(r.reply).toEqual({ text: "Hola", claims: [] });
  });
  it("still rejects smuggled fields", () => {
    expect(aiTurnResponseFormat.schema.safeParse({ ...strictSample, evil: 1 }).success).toBe(false);
  });
  it("works end to end through the provider in strict mode", async () => {
    const fetch = mockFetch(() => json(chatBody(JSON.stringify(strictSample))));
    const p = new OpenAICompatibleProvider({ baseUrl: "https://api.example.com/v1", apiKey: API_KEY, fetch, lookup: publicLookup });
    const r = await p.chat({ model: "m", messages: [], responseFormat: aiTurnResponseFormat });
    expect(r.structuredMode).toBe("json_schema");
    expect(r.parsed?.actions).toHaveLength(3);
    const sent = JSON.parse(String(fetch.mock.calls[0]![1]!.body)).response_format;
    expect(sent.json_schema.strict).toBe(true);
  });
});
