import { describe, expect, it } from "vitest";
import { extractContactFields } from "../extractor.js";
import { OpenAICompatibleProvider } from "../provider/openai-compatible.js";
import { API_KEY, chatBody, json, mockFetch, publicLookup } from "./helpers.js";

const msgs = [
  { id: "m1", text: "Hola, soy Ana Gómez, mi mail es ana@example.com" },
  { id: "m2", text: "Vivo en Córdoba" },
];

describe("extractContactFields", () => {
  it("returns update_contact_field actions and drops hallucinations", async () => {
    const fields = [
      { field: "name", value: "Ana Gómez", confidence: 0.95, sourceMessageId: "m1" },
      { field: "email", value: "ana@example.com", confidence: 0.99, sourceMessageId: "m1" },
      { field: "city", value: "Córdoba", confidence: 0.8, sourceMessageId: "m2" },
      { field: "phone", value: "+54 11 5555 0000", confidence: 0.9, sourceMessageId: "m1" }, // not in text
      { field: "company", value: "ACME", confidence: 0.9, sourceMessageId: "m9" }, // unknown message
    ];
    const fetch = mockFetch(() => json(chatBody(JSON.stringify({ fields }))));
    const p = new OpenAICompatibleProvider({ baseUrl: "https://api.example.com/v1", apiKey: API_KEY, fetch, lookup: publicLookup });
    const out = await extractContactFields(p, "gpt-5-mini", msgs);
    expect(out).toEqual([
      { type: "update_contact_field", field: "name", value: "Ana Gómez", confidence: 0.95, sourceMessageId: "m1" },
      { type: "update_contact_field", field: "email", value: "ana@example.com", confidence: 0.99, sourceMessageId: "m1" },
      { type: "update_contact_field", field: "city", value: "Córdoba", confidence: 0.8, sourceMessageId: "m2" },
    ]);
    const body = JSON.parse(String(fetch.mock.calls[0]![1]!.body));
    expect(body.response_format.type).toBe("json_schema");
    expect(body.response_format.json_schema.strict).toBe(true);
  });
  it("rejects model output with unexpected fields", async () => {
    const fetch = mockFetch(() => json(chatBody(JSON.stringify({ fields: [], note: "x" }))));
    const p = new OpenAICompatibleProvider({ baseUrl: "https://api.example.com/v1", apiKey: API_KEY, fetch, lookup: publicLookup });
    await expect(extractContactFields(p, "m", msgs)).rejects.toThrow(/schema validation/);
  });
  it("skips the call with no messages", async () => {
    const fetch = mockFetch(() => json({}));
    const p = new OpenAICompatibleProvider({ baseUrl: "https://api.example.com/v1", apiKey: API_KEY, fetch, lookup: publicLookup });
    expect(await extractContactFields(p, "m", [])).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });
});
