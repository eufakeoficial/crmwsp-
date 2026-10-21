import { describe, expect, it } from "vitest";
import { amountToMinor } from "@crmwsp/ai";
import {
  extractReceipt,
  handleReceipt,
  RECEIPT_ACK_TEXT,
  type ConversationState,
  type NewReview,
  type ReceiptImage,
  type ReceiptTxStore,
  type VisionOutcome,
} from "../receipt.js";
import type { NewNotification } from "../../notifications/notify.js";

const silent = { info: () => {}, warn: () => {}, error: () => {} };
const ORDER_ID = "00000000-0000-4000-8000-0000000000aa";
const image: ReceiptImage = {
  attachmentId: "00000000-0000-4000-8000-000000000001",
  externalMediaId: "https://bsp.example/media/1",
  mimeType: "image/jpeg",
  order: { id: ORDER_ID, number: "P-0007", totalMinor: 125050n, currency: "USD" },
};
const input = { conversationId: "00000000-0000-4000-8000-0000000000c1", messageId: "00000000-0000-4000-8000-0000000000d1", image };

/** In-memory world: an order that must stay `pending_payment` whatever the receipt says. */
function fakeWorld(conv: ConversationState = { aiMode: "auto", assignedUserId: null, status: "open", lastInboundAt: new Date() }) {
  const world = {
    order: { id: ORDER_ID, status: "pending_payment" as string, paidAt: null as Date | null },
    reviews: [] as NewReview[],
    usage: [] as Array<{ model: string }>,
    notifications: [] as NewNotification[],
    replies: [] as Array<{ id: string; body: string; clientId: string }>,
    calls: [] as string[],
  };
  const store: ReceiptTxStore = {
    async reviewExists(mid) {
      world.calls.push("reviewExists");
      return world.reviews.some((r) => r.messageId === mid);
    },
    async insertReview(r) {
      world.calls.push("insertReview");
      if (world.reviews.some((x) => x.messageId === r.messageId)) return null;
      world.reviews.push(r);
      return `review-${world.reviews.length}`;
    },
    async recordVisionUsage(u) {
      world.calls.push("recordVisionUsage");
      world.usage.push({ model: u.model });
    },
    async notify(n) {
      world.calls.push("notify");
      world.notifications.push(n);
    },
    async conversationState() {
      return conv;
    },
    async insertReply(body, clientId) {
      world.calls.push("insertReply");
      if (world.replies.some((r) => r.clientId === clientId)) return null;
      const id = `msg-${world.replies.length + 1}`;
      world.replies.push({ id, body, clientId });
      return id;
    },
    async findReply(clientId) {
      const r = world.replies.find((x) => x.clientId === clientId);
      return r ? { id: r.id, queued: true } : undefined;
    },
  };
  return { world, inTx: <T>(fn: (s: ReceiptTxStore) => Promise<T>) => fn(store) };
}

const extracted = (over: Partial<Extract<VisionOutcome, { status: "extracted" }>> = {}): VisionOutcome => ({
  status: "extracted",
  amountMinor: 125050n,
  currency: "USD",
  date: "2026-10-20",
  reference: "OP-123",
  confidence: 0.97,
  isReceipt: true,
  model: "gpt-4o-mini",
  usage: { inputTokens: 900, outputTokens: 40 },
  ...over,
});

describe("handleReceipt", () => {
  it("NEVER transitions the order, even for a perfect matching receipt with full confidence", async () => {
    const { world, inTx } = fakeWorld();
    const res = await handleReceipt(
      { inTx, extract: async () => extracted({ confidence: 1 }), canAutoReply: () => true, replyClientMessageId: "cid" },
      input,
    );
    expect(res.outcome).toBe("created");
    expect(world.order).toEqual({ id: ORDER_ID, status: "pending_payment", paidAt: null });
    // The store port has no order/payment method at all; only these writes happened.
    expect(new Set(world.calls)).toEqual(new Set(["reviewExists", "insertReview", "recordVisionUsage", "notify", "insertReply"]));
    expect(world.reviews[0]).toMatchObject({ orderId: ORDER_ID, extraction: "extracted", amountMinor: 125050n, confidence: 1 });
  });

  it("books the vision cost, notifies the team and acknowledges the customer", async () => {
    const { world, inTx } = fakeWorld();
    const res = await handleReceipt({ inTx, extract: async () => extracted(), canAutoReply: () => true, replyClientMessageId: "cid" }, input);
    expect(world.usage).toEqual([{ model: "gpt-4o-mini" }]);
    expect(world.notifications[0]).toMatchObject({ kind: "payment_review", entity: "payment_review", dedupeKey: "payment_review:review-1" });
    expect(world.replies[0]?.body).toBe(RECEIPT_ACK_TEXT("P-0007"));
    expect(res.enqueueMessageId).toBe("msg-1");
    expect(res.events).toEqual([{ type: "message.created", conversationId: input.conversationId, messageId: "msg-1" }]);
  });

  it("without vision support still creates a review for a human, with no extracted fields and no cost", async () => {
    const { world, inTx } = fakeWorld();
    await handleReceipt(
      { inTx, extract: async () => ({ status: "unsupported", reason: "provider_without_vision" }), canAutoReply: () => true, replyClientMessageId: "cid" },
      input,
    );
    expect(world.reviews[0]).toMatchObject({ extraction: "unsupported", amountMinor: null, confidence: null, model: null });
    expect(world.usage).toEqual([]);
    expect(world.order.status).toBe("pending_payment");
  });

  it("does not reply when a human owns the conversation", async () => {
    const { world, inTx } = fakeWorld();
    const res = await handleReceipt({ inTx, extract: async () => extracted(), canAutoReply: () => false, replyClientMessageId: "cid" }, input);
    expect(world.replies).toEqual([]);
    expect(res.replied).toBe(false);
    expect(world.notifications).toHaveLength(1);
  });

  it("is idempotent: a replay neither re-extracts nor duplicates rows, and recovers a lost enqueue", async () => {
    const { world, inTx } = fakeWorld();
    let extractCalls = 0;
    const ports = { inTx, extract: async () => (extractCalls++, extracted()), canAutoReply: () => true, replyClientMessageId: "cid" };
    await handleReceipt(ports, input);
    const replay = await handleReceipt(ports, input);
    expect(extractCalls).toBe(1);
    expect(replay.outcome).toBe("already-processed");
    expect(replay.enqueueMessageId).toBe("msg-1");
    expect(world.reviews).toHaveLength(1);
    expect(world.notifications).toHaveLength(1);
  });
});

describe("extractReceipt", () => {
  const ports = {
    tenantId: "t",
    conversationId: "c",
    model: "gpt-4o-mini",
    logger: silent,
    loadMedia: async () => ({ data: new Uint8Array([1, 2, 3]), mimeType: "image/jpeg" }),
  };

  it("skips the provider when the connection has no vision capability", async () => {
    let called = false;
    const out = await extractReceipt(image, {
      ...ports,
      supported: false,
      provider: { chat: async () => ((called = true), Promise.reject(new Error("no"))) },
    });
    expect(out).toEqual({ status: "unsupported", reason: "provider_without_vision" });
    expect(called).toBe(false);
  });

  it("sends the image to the model and normalizes the fields", async () => {
    let sentImages = 0;
    const out = await extractReceipt(image, {
      ...ports,
      supported: true,
      provider: {
        chat: async (req) => {
          sentImages = req.messages.flatMap((m) => m.images ?? []).length;
          return {
            content: "",
            parsed: { isReceipt: true, amount: "1250.5", currency: "usd", date: "2026-10-20", reference: "OP-1", confidence: 0.9 },
            usage: { inputTokens: 10, outputTokens: 5 },
            model: "gpt-4o-mini",
            finishReason: "stop",
          } as never;
        },
      },
    });
    expect(sentImages).toBe(1);
    expect(out).toMatchObject({ status: "extracted", amountMinor: 125050n, currency: "USD", confidence: 0.9 });
  });

  it("never throws on provider errors", async () => {
    const out = await extractReceipt(image, { ...ports, supported: true, provider: { chat: async () => Promise.reject(new Error("boom")) } });
    expect(out).toEqual({ status: "failed", reason: "vision_error" });
  });

  it("caps confidence for images that are not receipts", async () => {
    const out = await extractReceipt(image, {
      ...ports,
      supported: true,
      provider: {
        chat: async () =>
          ({ content: "", parsed: { isReceipt: false, amount: null, currency: null, date: null, reference: null, confidence: 0.95 }, usage: { inputTokens: 1, outputTokens: 1 }, model: "m", finishReason: "stop" }) as never,
      },
    });
    expect(out).toMatchObject({ status: "extracted", confidence: 0.1, amountMinor: null });
  });
});

describe("amountToMinor", () => {
  it.each([
    ["1250.50", 125050n],
    ["10", 1000n],
    ["0.5", 50n],
    ["1,250.50", null],
    ["-5", null],
    ["0", null],
    [null, null],
  ])("%s -> %s", (raw, expected) => {
    expect(amountToMinor(raw)).toBe(expected);
  });
});
