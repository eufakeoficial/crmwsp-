import { describe, expect, it } from "vitest";
import { messageSchema, quoteActivityResponseSchema } from "../index.js";

const message = {
  id: "11111111-1111-4111-8111-111111111111",
  conversationId: "22222222-2222-4222-8222-222222222222",
  direction: "outbound",
  type: "text",
  body: "Hola",
  status: "sent",
  author: "ai",
  authorUserId: null,
  clientMessageId: null,
  error: null,
  reaction: null,
  reactionBy: null,
  sentAt: null,
  createdAt: "2026-10-20T12:00:00.000Z",
  attachments: [],
};

describe("messageSchema citations", () => {
  it("accepts messages with and without citations", () => {
    expect(messageSchema.parse(message).citations).toBeUndefined();
    const withCitations = { ...message, citations: [{ chunkId: "c1", title: "Catálogo", excerpt: "Limpieza desde $40" }] };
    expect(messageSchema.parse(withCitations).citations).toHaveLength(1);
  });
  it("rejects a citation without a title", () => {
    expect(messageSchema.safeParse({ ...message, citations: [{ chunkId: "c1", excerpt: "x" }] }).success).toBe(false);
  });
});

describe("quoteActivityResponseSchema", () => {
  it("parses an activity list", () => {
    const r = quoteActivityResponseSchema.parse({
      items: [{ id: "order_paid:o1", kind: "order_paid", at: "2026-10-20T12:00:00.000Z", orderNumber: "P-1", verifiedBy: "manual" }],
    });
    expect(r.items[0]?.verifiedBy).toBe("manual");
  });
  it("rejects unknown kinds", () => {
    expect(quoteActivityResponseSchema.safeParse({ items: [{ id: "x", kind: "nope", at: "2026-10-20T12:00:00.000Z", orderNumber: null, verifiedBy: null }] }).success).toBe(false);
  });
});
