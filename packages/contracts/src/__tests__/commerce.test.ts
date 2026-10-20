import { describe, expect, it } from "vitest";
import { createOrderRequestSchema, videoLinkRequestSchema, markPaidRequestSchema, variantInputSchema } from "../commerce.js";
import { InsufficientStockError, StorageNotConfiguredError, toErrorResponse } from "../errors.js";

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
