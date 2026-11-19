import { describe, expect, it } from "vitest";
import type { AiTurnOutput } from "@crmwsp/contracts";
import { aiTurnResponseFormat } from "../ai-turn-schema.js";
import { sanitizeReplyText, sanitizeTurnReply } from "../reply-sanitizer.js";

const ID = "47035704-0a54-4a5a-89fb-4de65d9d1221";
const OTHER = "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d";
const ctx = { chunkIds: [ID, "11111111-2222-4333-8444-555555555555"] };

describe("sanitizeReplyText", () => {
  it.each([
    [`La clase suelta cuesta S/ 40 (chunkId: ${ID}).`, "La clase suelta cuesta S/ 40."],
    [`Cuesta S/ 40 [chunk_id=${ID}] y dura 1 hora.`, "Cuesta S/ 40 y dura 1 hora."],
    [`Cuesta S/ 40 chunkId: ${ID}`, "Cuesta S/ 40"],
    ["Precio S/ 40 (fuente: chunk 2).", "Precio S/ 40."],
  ])("strips explicit chunk references without context: %s", (input, expected) => {
    expect(sanitizeReplyText(input)).toBe(expected);
  });

  it.each([
    [`Referencia ${ID} interna.`, "Referencia interna."],
    ["Cuesta S/ 40 [1] y la mensualidad S/ 250 [1, 2].", "Cuesta S/ 40 y la mensualidad S/ 250."],
    ["Cuesta S/ 40.[2]", "Cuesta S/ 40."],
  ])("strips retrieved-chunk UUIDs and in-range markers: %s", (input, expected) => {
    expect(sanitizeReplyText(input, ctx)).toBe(expected);
  });

  it.each([
    ["an unrelated UUID (e.g. an order id)", `Tu pedido ${OTHER} está confirmado.`],
    ["a bare UUID without chunk context", `Tu pedido ${ID} está confirmado.`],
    ["an order/quote reference", "Tu presupuesto (ref: 12345) sigue vigente. (Ref. pedido 778)"],
    ["an enumeration at line start", "Opciones:\n[1] Salsa\n[2] Bachata"],
    ["an out-of-range marker", "Ver punto [7] del reglamento."],
    ["ordinary parentheses and 'cita'", "¡Hola! Salsa (lunes y miércoles) a las 19:00. ¿Te reservo una cita?"],
    ["a source mention that is not a chunk", "(fuente: reglamento interno)"],
  ])("keeps %s", (_label, text) => {
    const withCtx = text.includes(ID) ? {} : ctx;
    expect(sanitizeReplyText(text, withCtx)).toBe(text);
  });

  it("keeps line breaks", () => {
    expect(sanitizeReplyText(`Hola [1]\nSalsa: S/ 40 (chunkId: ${ID})`, ctx)).toBe("Hola\nSalsa: S/ 40");
  });

  it("stays linear on long adversarial input", () => {
    const evil = `${" ".repeat(50_000)}(chunk${"x".repeat(50_000)}${"[1".repeat(20_000)}`;
    const started = performance.now();
    sanitizeReplyText(evil, ctx);
    expect(performance.now() - started).toBeLessThan(500);
  });
});

describe("sanitizeTurnReply", () => {
  const base: AiTurnOutput = { actions: [], confidence: 0.9, needsHuman: false, reason: "r" };

  it("flags a reply that was only markers", () => {
    const out = sanitizeTurnReply({ ...base, reply: { text: ` ${ID} `, claims: [] } }, ctx);
    expect(out.reply).toBeUndefined();
    expect(out.replyDropped).toBe(true);
  });

  it("returns the same object when nothing changes", () => {
    const o = { ...base, reply: { text: "Hola", claims: [] } };
    expect(sanitizeTurnReply(o, ctx)).toBe(o);
  });
});

describe("structured output never carries chunk ids in reply.text", () => {
  const raw = { actions: [], reaction: null, salesStage: null, objection: null, confidence: 0.9, needsHuman: false, reason: "r" };

  it("sanitizes text but keeps the structured citations", () => {
    const parsed = aiTurnResponseFormat.schema.parse({
      ...raw,
      reply: {
        text: `No regalamos clases; la clase suelta cuesta S/ 40 (chunkId: ${ID}).`,
        claims: [{ kind: "price", text: "S/ 40", citations: [{ chunkId: ID }] }],
      },
    });
    expect(parsed.reply?.text).toBe("No regalamos clases; la clase suelta cuesta S/ 40.");
    expect(parsed.reply?.claims[0]?.citations[0]?.chunkId).toBe(ID);
    expect(parsed.replyDropped).toBeUndefined();
  });

  it("drops a reply that was only markers and flags it", () => {
    const parsed = aiTurnResponseFormat.schema.parse({ ...raw, reply: { text: `(chunkId: ${ID})`, claims: [] } });
    expect(parsed.reply).toBeUndefined();
    expect(parsed.replyDropped).toBe(true);
  });

  it("ignores a replyDropped sent by the model", () => {
    const parsed = aiTurnResponseFormat.schema.parse({ ...raw, reply: null, replyDropped: true });
    expect(parsed.replyDropped).toBeUndefined();
  });
});
