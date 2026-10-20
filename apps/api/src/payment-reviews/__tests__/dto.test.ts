import { describe, expect, it } from "vitest";
import { toDto } from "../payment-reviews.controller.js";

const base = {
  id: "00000000-0000-4000-8000-000000000001",
  tenantId: "00000000-0000-4000-8000-000000000002",
  orderId: "00000000-0000-4000-8000-000000000003",
  conversationId: "00000000-0000-4000-8000-000000000004",
  messageId: "00000000-0000-4000-8000-000000000005",
  attachmentId: null,
  status: "pending" as const,
  extraction: "extracted" as const,
  extractedAmountMinor: 1000n as bigint | null,
  extractedCurrency: "usd" as string | null,
  extractedDate: null,
  extractedReference: null,
  confidence: "0.900" as string | null,
  model: "m",
  reviewedBy: null,
  reviewedAt: null,
  rejectReason: null,
  createdAt: new Date("2026-10-20T00:00:00Z"),
  updatedAt: new Date("2026-10-20T00:00:00Z"),
};
const o = { id: base.orderId, number: "P-1", status: "pending_payment", totalMinor: 1000n, currency: "USD" };
const c = { id: "00000000-0000-4000-8000-000000000006", name: null, phoneE164: "+15550000000" };

describe("payment review DTO", () => {
  it("flags a matching amount and currency", () => {
    const d = toDto({ r: base, o, c });
    expect(d.amountMatches).toBe(true);
    expect(d.extracted.confidence).toBe(0.9);
  });
  it("does not match a different amount or a missing reading", () => {
    expect(toDto({ r: { ...base, extractedAmountMinor: 999n }, o, c }).amountMatches).toBe(false);
    expect(toDto({ r: { ...base, extractedAmountMinor: null, confidence: null }, o, c }).amountMatches).toBe(false);
  });
});
