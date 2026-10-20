import { describe, expect, it } from "vitest";
import {
  createQuoteRequestSchema,
  moveOpportunityRequestSchema,
  quoteItemInputSchema,
  publicQuoteSchema,
  patchTaskRequestSchema,
  listOpportunitiesQuerySchema,
} from "../sales.js";

const id = "0b0f6c3e-5b1c-4f5e-9a64-2a3c5d6e7f80";

describe("sales contracts", () => {
  it("requires description and price on free lines but not on catalog lines", () => {
    expect(quoteItemInputSchema.safeParse({ quantityMilli: 1000 }).success).toBe(false);
    expect(quoteItemInputSchema.safeParse({ quantityMilli: 1000, description: "x" }).success).toBe(false);
    expect(quoteItemInputSchema.safeParse({ quantityMilli: 1000, description: "x", unitPriceMinor: 5 }).success).toBe(true);
    expect(quoteItemInputSchema.safeParse({ quantityMilli: 1000, productId: id }).success).toBe(true);
  });
  it("rejects float money and quantities", () => {
    expect(quoteItemInputSchema.safeParse({ quantityMilli: 1000, productId: id, unitPriceMinor: 1.5 }).success).toBe(false);
    expect(quoteItemInputSchema.safeParse({ quantityMilli: 0.5, productId: id }).success).toBe(false);
  });
  it("normalizes a calendar validUntil to end of day UTC", () => {
    const r = createQuoteRequestSchema.parse({
      contactId: id,
      currency: "EUR",
      validUntil: "2026-12-31",
      items: [{ productId: id, quantityMilli: 1000 }],
    });
    expect(r.validUntil).toBe("2026-12-31T23:59:59.999Z");
  });
  it("move needs lockVersion; tasks patch needs a field", () => {
    expect(moveOpportunityRequestSchema.safeParse({ stageId: id }).success).toBe(false);
    expect(patchTaskRequestSchema.safeParse({}).success).toBe(false);
  });
  it("opportunity list accepts me and defaults the limit", () => {
    expect(listOpportunitiesQuerySchema.parse({ ownerId: "me" }).limit).toBe(50);
  });
  it("public quote exposes no internal ids", () => {
    expect(Object.keys(publicQuoteSchema.shape)).not.toContain("id");
    expect(Object.keys(publicQuoteSchema.shape)).not.toContain("contact");
  });
});
