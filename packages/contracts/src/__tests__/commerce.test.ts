import { describe, expect, it } from "vitest";
import { createOrderRequestSchema, videoLinkRequestSchema, markPaidRequestSchema, variantInputSchema } from "../commerce.js";
import { InsufficientStockError, StorageNotConfiguredError, toErrorResponse } from "../errors.js";
import { wooConnectCodeResponseSchema, wooPublicConnectRequestSchema, wooPublicConnectResponseSchema } from "../integrations.js";

const id = "0b0f6c3e-5b1c-4f5e-9a64-2a3c5d6e7f80";

describe("commerce contracts", () => {
  it("video links must be https", () => {
    expect(videoLinkRequestSchema.safeParse({ kind: "video_link", url: "http://youtu.be/x" }).success).toBe(false);
    expect(videoLinkRequestSchema.safeParse({ kind: "video_link", url: "https://youtu.be/x" }).success).toBe(true);
    expect(videoLinkRequestSchema.safeParse({ kind: "video_link", url: "javascript:alert(1)" }).success).toBe(false);
  });
  it("shipping orders need an address", () => {
    const base = { contactId: id, items: [{ variantId: id, quantity: 1 }] };
    expect(createOrderRequestSchema.safeParse({ ...base, fulfillment: "shipping" }).success).toBe(false);
    expect(createOrderRequestSchema.safeParse({ ...base, fulfillment: "pickup" }).success).toBe(true);
    expect(createOrderRequestSchema.safeParse({ ...base, fulfillment: "pickup", shippingMinor: 100 }).success).toBe(false);
  });
  it("mark-paid requires a reason", () => {
    expect(markPaidRequestSchema.safeParse({}).success).toBe(false);
  });
  it("variant options stay undefined when omitted", () => {
    expect(variantInputSchema.parse({}).options).toBeUndefined();
  });
  it("new errors serialize with their codes", () => {
    expect(toErrorResponse(new InsufficientStockError(id))).toEqual({
      code: "INSUFFICIENT_STOCK",
      message: "Insufficient stock",
      details: { variantId: id },
    });
    expect(new StorageNotConfiguredError().httpStatus).toBe(503);
  });
});

describe("woocommerce connect contracts", () => {
  const valid = {
    code: "abcd-efgh-jk",
    shopUrl: "https://shop.example.com",
    consumerKey: "ck_0123456789abcdef",
    consumerSecret: "cs_0123456789abcdef",
    webhookSecret: "a-very-long-webhook-secret",
  };
  it("normalizes the code (case, dashes, spaces)", () => {
    const r = wooPublicConnectRequestSchema.parse({ ...valid, code: " abcd efgh-jk " });
    expect(r.code).toBe("ABCDEFGHJK");
  });
  it("rejects codes with look-alike chars or wrong length", () => {
    for (const code of ["ABCD-EFGH-J0", "ABCD-EFGH-JI", "ABCD-EFGH-J", "ABCD-EFGH-JKL"]) {
      expect(wooPublicConnectRequestSchema.safeParse({ ...valid, code }).success).toBe(false);
    }
  });
  it("requires https, key formats, a long webhook secret and no extra fields", () => {
    expect(wooPublicConnectRequestSchema.safeParse(valid).success).toBe(true);
    expect(wooPublicConnectRequestSchema.safeParse({ ...valid, shopUrl: "http://shop.example.com" }).success).toBe(false);
    expect(wooPublicConnectRequestSchema.safeParse({ ...valid, consumerKey: "cs_0123456789abcdef" }).success).toBe(false);
    expect(wooPublicConnectRequestSchema.safeParse({ ...valid, consumerSecret: "ck_0123456789abcdef" }).success).toBe(false);
    expect(wooPublicConnectRequestSchema.safeParse({ ...valid, webhookSecret: "short" }).success).toBe(false);
    expect(wooPublicConnectRequestSchema.safeParse({ ...valid, extra: 1 }).success).toBe(false);
  });
  it("response shapes", () => {
    expect(wooConnectCodeResponseSchema.safeParse({ code: "ABCD-EFGH-JK", expiresAt: "2026-01-01T00:00:00.000Z" }).success).toBe(true);
    expect(wooPublicConnectResponseSchema.safeParse({ webhookUrl: "https://api/x", tenantName: "T" }).success).toBe(true);
  });
});
