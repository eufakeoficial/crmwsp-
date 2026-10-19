import { describe, expect, it } from "vitest";
import { createGupshupChannelRequestSchema, updateChannelRequestSchema } from "../index.js";

describe("createGupshupChannelRequestSchema", () => {
  it("accepts a valid request", () => {
    expect(
      createGupshupChannelRequestSchema.safeParse({ phoneE164: "+34600111222", appName: "Demo", apiKey: "abcdefgh1234" })
        .success,
    ).toBe(true);
  });
  it("rejects bad phone, empty app name and short key", () => {
    expect(createGupshupChannelRequestSchema.safeParse({ phoneE164: "600", appName: "D", apiKey: "abcdefgh" }).success).toBe(false);
    expect(createGupshupChannelRequestSchema.safeParse({ phoneE164: "+34600111222", appName: " ", apiKey: "abcdefgh" }).success).toBe(false);
    expect(createGupshupChannelRequestSchema.safeParse({ phoneE164: "+34600111222", appName: "D", apiKey: "x" }).success).toBe(false);
  });
});

describe("updateChannelRequestSchema", () => {
  it("only allows active or disabled", () => {
    expect(updateChannelRequestSchema.safeParse({ status: "disabled" }).success).toBe(true);
    expect(updateChannelRequestSchema.safeParse({ status: "pending" }).success).toBe(false);
  });
});
