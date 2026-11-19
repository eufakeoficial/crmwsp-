import { describe, expect, it } from "vitest";
import { aiTurnResponseFormat } from "../ai-turn-schema.js";
import { sanitizeReplyText } from "../reply-sanitizer.js";

const ID = "47035704-0a54-4a5a-89fb-4de65d9d1221";

describe("sanitizeReplyText", () => {
  it.each([
    [`La clase suelta cuesta S/ 40 (chunkId: ${ID}).`, "La clase suelta cuesta S/ 40."],
    [`Cuesta S/ 40 [chunk_id=${ID}] y dura 1 hora.`, "Cuesta S/ 40 y dura 1 hora."],
    [`Cuesta S/ 40 chunkId: ${ID}`, "Cuesta S/ 40"],
    [`Referencia ${ID} interna.`, "Referencia interna."],
    ["Cuesta S/ 40 [1] y la mensualidad S/ 250 [2, 3].", "Cuesta S/ 40 y la mensualidad S/ 250."],
    ["Precio S/ 40 (fuente: chunk 2).", "Precio S/ 40."],
  ])("strips markers from %s", (input, expected) => {
    expect(sanitizeReplyText(input)).toBe(expected);
  });

  it("leaves ordinary text and parentheses alone", () => {
    const text = "¡Hola! Tenemos salsa (lunes y miércoles) a las 19:00. ¿Te reservo una cita?";
    expect(sanitizeReplyText(text)).toBe(text);
  });

  it("keeps line breaks", () => {
    expect(sanitizeReplyText(`Hola [1]\nSalsa: S/ 40 (chunkId: ${ID})`)).toBe("Hola\nSalsa: S/ 40");
  });
});

describe("structured output never carries chunk ids in reply.text", () => {
  const base = { actions: [], reaction: null, salesStage: null, objection: null, confidence: 0.9, needsHuman: false, reason: "r" };

  it("sanitizes text but keeps the structured citations", () => {
    const parsed = aiTurnResponseFormat.schema.parse({
      ...base,
      reply: {
        text: `No regalamos clases; la clase suelta cuesta S/ 40 (chunkId: ${ID}).`,
        claims: [{ kind: "price", text: "S/ 40", citations: [{ chunkId: ID }] }],
      },
    });
    expect(parsed.reply?.text).toBe("No regalamos clases; la clase suelta cuesta S/ 40.");
    expect(parsed.reply?.claims[0]?.citations[0]?.chunkId).toBe(ID);
  });

  it("drops a reply that was only markers", () => {
    const parsed = aiTurnResponseFormat.schema.parse({ ...base, reply: { text: `(chunkId: ${ID})`, claims: [] } });
    expect(parsed.reply).toBeUndefined();
  });
});
