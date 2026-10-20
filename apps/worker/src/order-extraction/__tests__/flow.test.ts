import type { ChatRequest, ChatResult, OrderExtractionOutput } from "@crmwsp/ai";
import type { CatalogCandidate, DraftLine } from "@crmwsp/domain";
import { describe, expect, it, vi } from "vitest";
import {
  handleOrderExtraction,
  type ExtractionContext,
  type LlmAccess,
  type NewExtraction,
  type OrderFlowPorts,
  type OrderTxStore,
} from "../flow.js";
import { orderSourceOf } from "../queue.js";

const silent = { info: () => {}, warn: () => {}, error: () => {} };

const catalog: CatalogCandidate[] = [
  { productId: "00000000-0000-4000-8000-00000000000a", variantId: null, productVersion: 1, label: "Modelo A", searchText: "", sku: "MA", unit: "caja", priceMinor: 2500n, currency: "EUR", taxRateBp: 2100 },
  { productId: "00000000-0000-4000-8000-00000000000b", variantId: "00000000-0000-4000-8000-0000000000b1", productVersion: 1, label: "Modelo B (Rojo)", searchText: "Modelo B Rojo", sku: null, unit: "caja", priceMinor: 1000n, currency: "EUR", taxRateBp: 2100 },
  { productId: "00000000-0000-4000-8000-00000000000b", variantId: "00000000-0000-4000-8000-0000000000b2", productVersion: 1, label: "Modelo B (Azul)", searchText: "Modelo B Azul", sku: null, unit: "caja", priceMinor: 1000n, currency: "EUR", taxRateBp: 2100 },
];

/** Fixture: what the model returns for "mándame 12 cajas del modelo A y 6 del B" (audio, image or PDF alike). */
const ORDER_OUTPUT: OrderExtractionOutput = {
  items: [
    { rawText: "12 cajas del modelo A", quantity: 12, unit: "cajas", productGuess: "modelo A" },
    { rawText: "6 del B", quantity: 6, unit: null, productGuess: "modelo B" },
  ],
  notes: "Entregar el lunes",
};
const TRANSCRIPT_FIXTURE = "Hola, mándame 12 cajas del modelo A y 6 del B, para el lunes.";
const PDF_TEXT_FIXTURE = "PEDIDO 0042\nCant. Producto\n12 cajas Modelo A\n6 Modelo B";
const IMAGE_FIXTURE = { data: new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), mimeType: "image/jpeg" };

function fakeStore() {
  const state = {
    extractions: [] as NewExtraction[],
    quotes: [] as Array<{ lines: DraftLine[]; currency: string }>,
    usage: [] as unknown[],
    audits: [] as unknown[],
    notifications: [] as Array<{ kind: string; title: string }>,
    replies: [] as string[],
    linked: [] as string[],
  };
  const store: OrderTxStore = {
    existingExtraction: async () => (state.extractions[0] ? { status: state.extractions[0].status, reason: state.extractions[0].reason } : undefined),
    insertExtraction: async (r) => (state.extractions.push(r), `ext-${state.extractions.length}`),
    loadCatalog: async () => catalog,
    createQuoteDraft: async (lines, currency) => (state.quotes.push({ lines, currency }), { id: "q-1", number: "P-2026-0001" }),
    linkQuote: async (_e, q) => void state.linked.push(q),
    recordUsage: async (u) => void state.usage.push(u),
    audit: async (_id, d) => void state.audits.push(d),
    notify: async (n) => void state.notifications.push(n),
    conversationState: async () => ({ aiMode: "auto", assignedUserId: null, status: "open", lastInboundAt: new Date() }),
    insertReply: async (body) => (state.replies.push(body), "reply-1"),
  };
  return { state, store };
}

function ports(ctx: Partial<ExtractionContext> & { source: ExtractionContext["source"] }, over: Partial<Omit<OrderFlowPorts, "llm">> & { llm?: Partial<LlmAccess>; output?: OrderExtractionOutput | null } = {}) {
  const { state, store } = fakeStore();
  const chat = vi.fn(async (req: ChatRequest): Promise<ChatResult> => {
    void req;
    return { content: "{}", parsed: over.output === undefined ? ORDER_OUTPUT : (over.output ?? undefined), usage: { inputTokens: 100, outputTokens: 50 }, model: "m", finishReason: "stop" };
  });
  const llm: LlmAccess = { provider: { chat: chat as LlmAccess["provider"]["chat"] }, model: "cheap", visionModel: "vision", visionSupported: true, budgetExceeded: false, ...over.llm };
  const { llm: _l, output: _o, ...rest } = over;
  const p: OrderFlowPorts = {
    context: async () => ({
      attachmentId: "att-1",
      externalMediaId: "media-1",
      mimeType: null,
      transcript: null,
      hasPendingPaymentOrder: false,
      quoteDraftDenied: false,
      ...ctx,
    }),
    llm: async () => llm,
    loadMedia: async () => IMAGE_FIXTURE,
    inTx: (fn) => fn(store),
    canAutoReply: () => true,
    replyClientMessageId: "order-extraction-reply-m1",
    conversationId: "conv-1",
    logger: silent,
    ...rest,
  };
  return { p, state, chat };
}

describe("orderSourceOf", () => {
  it("maps mime types", () => {
    expect(orderSourceOf("audio/ogg; codecs=opus")).toBe("audio");
    expect(orderSourceOf("image/jpeg")).toBe("image");
    expect(orderSourceOf("application/pdf")).toBe("pdf");
    expect(orderSourceOf("video/mp4")).toBeNull();
    expect(orderSourceOf(null)).toBeNull();
  });
});

describe("handleOrderExtraction", () => {
  it("audio transcript -> draft quote with matched lines, dudoso asked back, cost recorded", async () => {
    const { p, state, chat } = ports({ source: "audio", transcript: TRANSCRIPT_FIXTURE });
    const out = await handleOrderExtraction(p);
    expect(out).toMatchObject({ outcome: "created", status: "needs_confirmation", quoteId: "q-1", replied: true, enqueueMessageId: "reply-1" });
    expect(chat.mock.calls[0]![0].messages[1]!.content).toContain(TRANSCRIPT_FIXTURE);
    expect(chat.mock.calls[0]![0].model).toBe("cheap");
    const ext = state.extractions[0]!;
    expect(ext.items.map((i) => i.status)).toEqual(["matched", "dudoso"]);
    expect(ext.items[0]!.match?.unitPriceMinor).toBe("2500");
    expect(ext.notes).toBe("Entregar el lunes");
    // Only the confident line is quoted, at the catalog price.
    expect(state.quotes[0]!.lines).toHaveLength(1);
    expect(state.quotes[0]!.lines[0]!.unitPriceMinor).toBe(2500n);
    expect(state.quotes[0]!.lines[0]!.quantityMilli).toBe(12_000n);
    expect(state.usage).toHaveLength(1);
    expect(state.audits).toHaveLength(1);
    expect(state.notifications[0]!.title).toBe("Pedido detectado (audio)");
    expect(state.replies[0]).toContain("¿El «modelo B» es Modelo B (Azul) o Modelo B (Rojo)?");
  });

  it("audio without transcript is transcribed by the extraction itself", async () => {
    const transcribe = vi.fn(async () => TRANSCRIPT_FIXTURE);
    const { p, state } = ports({ source: "audio" }, { transcribe });
    expect(await handleOrderExtraction(p)).toMatchObject({ outcome: "created", replied: true });
    expect(transcribe).toHaveBeenCalledOnce();
    expect(state.replies).toHaveLength(1);
  });

  it("untranscribable audio hands the message to the AI turn", async () => {
    const { p, chat } = ports({ source: "audio" }, { transcribe: async () => null });
    expect(await handleOrderExtraction(p)).toMatchObject({ outcome: "skipped", reason: "no_transcript", aiTurn: true });
    expect(chat).not.toHaveBeenCalled();
  });

  it("chit-chat voice notes never reach the LLM", async () => {
    const { p, chat, state } = ports({ source: "audio", transcript: "hola, ¿a qué hora abren?" });
    expect(await handleOrderExtraction(p)).toMatchObject({ outcome: "skipped", reason: "not_an_order", aiTurn: true });
    expect(state.replies).toHaveLength(0);
    expect(chat).not.toHaveBeenCalled();
    expect(state.extractions).toHaveLength(0);
  });

  it("image -> vision model with the photo", async () => {
    const { p, chat, state } = ports({ source: "image", mimeType: "image/jpeg" });
    expect(await handleOrderExtraction(p)).toMatchObject({ outcome: "created", quoteId: "q-1" });
    const req = chat.mock.calls[0]![0];
    expect(req.model).toBe("vision");
    expect(req.messages[1]!.images?.[0]?.data).toEqual(IMAGE_FIXTURE.data);
    expect(state.notifications[0]!.title).toBe("Pedido detectado (foto)");
  });

  it("image without vision: no LLM call, skipped row and handoff", async () => {
    const { p, chat, state } = ports({ source: "image" }, { llm: { visionSupported: false } });
    expect(await handleOrderExtraction(p)).toMatchObject({ outcome: "created", status: "skipped" });
    expect(chat).not.toHaveBeenCalled();
    expect(state.extractions[0]).toMatchObject({ status: "skipped", reason: "provider_without_vision" });
    expect(state.notifications[0]!.kind).toBe("handoff");
    expect(state.quotes).toHaveLength(0);
  });

  it("image while a payment is pending belongs to the receipt flow", async () => {
    const { p, chat } = ports({ source: "image", hasPendingPaymentOrder: true });
    expect(await handleOrderExtraction(p)).toMatchObject({ outcome: "skipped", reason: "receipt_flow" });
    expect(chat).not.toHaveBeenCalled();
  });

  it("pdf -> parsed text to the cheap model", async () => {
    const pdfText = vi.fn(async () => PDF_TEXT_FIXTURE);
    const { p, chat } = ports({ source: "pdf", mimeType: "application/pdf" }, { pdfText, loadMedia: async () => ({ data: new Uint8Array([0x25, 0x50, 0x44, 0x46]), mimeType: "application/pdf" }) });
    expect(await handleOrderExtraction(p)).toMatchObject({ outcome: "created", quoteId: "q-1" });
    expect(pdfText).toHaveBeenCalledOnce();
    expect(chat.mock.calls[0]![0].messages[1]!.content).toContain("PEDIDO 0042");
  });

  it("an unreadable pdf is handed off to a human (no AI turn reply)", async () => {
    const { p, state } = ports({ source: "pdf" }, { pdfText: async () => "   " });
    expect(await handleOrderExtraction(p)).toMatchObject({ outcome: "created", status: "skipped", replied: false });
    expect(state.extractions[0]).toMatchObject({ status: "skipped", reason: "pdf_without_text" });
  });

  it("policy deny of create_quote_draft keeps the extraction but builds no quote", async () => {
    const { p, state } = ports({ source: "audio", transcript: TRANSCRIPT_FIXTURE, quoteDraftDenied: true });
    expect(await handleOrderExtraction(p)).toMatchObject({ outcome: "created", quoteId: null });
    expect(state.quotes).toHaveLength(0);
  });

  it("no auto reply when a human owns the conversation; budget exceeded skips everything", async () => {
    const human = ports({ source: "audio", transcript: TRANSCRIPT_FIXTURE }, { canAutoReply: () => false });
    expect(await handleOrderExtraction(human.p)).toMatchObject({ outcome: "created", replied: false });
    expect(human.state.replies).toHaveLength(0);
    const broke = ports({ source: "audio", transcript: TRANSCRIPT_FIXTURE }, { llm: { budgetExceeded: true } });
    expect(await handleOrderExtraction(broke.p)).toMatchObject({ outcome: "skipped", reason: "budget_exceeded" });
    expect(broke.chat).not.toHaveBeenCalled();
  });

  it("invalid model output is stored as failed with its cost; replays are no-ops", async () => {
    const bad = ports({ source: "audio", transcript: TRANSCRIPT_FIXTURE }, { output: null });
    expect(await handleOrderExtraction(bad.p)).toMatchObject({ outcome: "skipped", reason: "invalid_output" });
    expect(bad.state.extractions[0]).toMatchObject({ status: "failed" });
    expect(bad.state.usage).toHaveLength(1);
    expect(await handleOrderExtraction(bad.p)).toMatchObject({ outcome: "skipped", reason: "already-processed", aiTurn: true });
    expect(bad.chat).toHaveBeenCalledOnce();
  });
});
