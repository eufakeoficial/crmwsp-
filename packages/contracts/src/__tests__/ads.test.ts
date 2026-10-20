import { describe, expect, it } from "vitest";
import { upsertAdSpendRequestSchema, upsertMetaCapiRequestSchema } from "../ads.js";

describe("ads contracts", () => {
  it("validates manual ad spend", () => {
    expect(upsertAdSpendRequestSchema.parse({ sourceId: " 1202 ", currency: "EUR", amountMinor: 1000 }).sourceId).toBe("1202");
    expect(upsertAdSpendRequestSchema.safeParse({ sourceId: "1", currency: "eur", amountMinor: 1 }).success).toBe(false);
    expect(upsertAdSpendRequestSchema.safeParse({ sourceId: "1", currency: "EUR", amountMinor: -1 }).success).toBe(false);
    expect(upsertAdSpendRequestSchema.safeParse({ sourceId: "1", currency: "EUR", amountMinor: 1, x: 1 }).success).toBe(false);
  });

  it("validates the Conversions API config", () => {
    expect(upsertMetaCapiRequestSchema.safeParse({ datasetId: "123456789012345", accessToken: "EAAB".padEnd(40, "x") }).success).toBe(true);
    expect(upsertMetaCapiRequestSchema.safeParse({ datasetId: "abc" }).success).toBe(false);
    expect(upsertMetaCapiRequestSchema.safeParse({ datasetId: "123456", accessToken: "short" }).success).toBe(false);
  });
});
