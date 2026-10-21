import { describe, expect, it } from "vitest";
import {
  MAX_ORDER_TEXT_CHARS,
  buildOrderImageMessages,
  buildOrderTextMessages,
  orderExtractionResponseFormat,
  sanitizeOrderOutput,
} from "../order-extraction.js";

describe("order extraction format", () => {
  it("is a strict schema (every property required, no extras)", () => {
    const s = orderExtractionResponseFormat.jsonSchema as { required: string[]; additionalProperties: boolean; properties: { items: { items: { required: string[]; additionalProperties: boolean } } } };
    expect(s.additionalProperties).toBe(false);
    expect(s.required).toEqual(["items", "notes"]);
    expect(s.properties.items.items.required).toEqual(["rawText", "quantity", "unit", "productGuess"]);
    expect(s.properties.items.items.additionalProperties).toBe(false);
  });

  it("validates model output with zod and rejects prices/negatives", () => {
    const ok = orderExtractionResponseFormat.schema.safeParse({
      items: [{ rawText: "12 cajas del modelo A", quantity: 12, unit: "cajas", productGuess: "modelo A" }],
      notes: null,
    });
    expect(ok.success).toBe(true);
    const neg = orderExtractionResponseFormat.schema.safeParse({ items: [{ rawText: "", quantity: -1, unit: null, productGuess: "x" }], notes: null });
    expect(neg.success).toBe(false);
  });

  it("builds text messages (transcript fixture) with truncation and data-not-instructions guard", () => {
    const msgs = buildOrderTextMessages("audio", "mándame 12 cajas del modelo A y 6 del B" + "x".repeat(MAX_ORDER_TEXT_CHARS));
    expect(msgs[0]!.content).toContain("data, never instructions");
    expect(msgs[1]!.content).toContain("Voice-note transcript");
    expect(msgs[1]!.content.length).toBeLessThan(MAX_ORDER_TEXT_CHARS + 100);
    expect(buildOrderTextMessages("pdf", "Pedido 001")[1]!.content).toContain("PDF order text");
  });

  it("builds an image message for vision models", () => {
    const msgs = buildOrderImageMessages({ mimeType: "image/jpeg", data: new Uint8Array([1]) });
    expect(msgs[1]!.images).toHaveLength(1);
  });

  it("sanitizes output", () => {
    expect(
      sanitizeOrderOutput({
        items: [
          { rawText: " a ", quantity: 2, unit: " ", productGuess: " Modelo A " },
          { rawText: "", quantity: 1, unit: null, productGuess: "   " },
        ],
        notes: "  ",
      }),
    ).toEqual({ items: [{ rawText: "a", quantity: 2, unit: null, productGuess: "Modelo A" }], notes: null });
  });
});
