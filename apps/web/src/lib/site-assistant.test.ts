import { siteAssistantRequestSchema } from "@crmwsp/contracts";
import { describe, expect, it } from "vitest";
import { ApiError } from "./api";
import { friendlyError, historyForRequest, salesWhatsappHref } from "./site-assistant";

describe("site assistant client helpers", () => {
  it("builds a wa.me link only for a plausible number", () => {
    expect(salesWhatsappHref("+54 9 11 1234-5678")).toMatch(/^https:\/\/wa\.me\/5491112345678\?text=/);
    expect(salesWhatsappHref(undefined)).toBeNull();
    expect(salesWhatsappHref("123")).toBeNull();
  });

  it("keeps a contract-valid trailing window", () => {
    const msgs = Array.from({ length: 15 }, (_, i) => ({ role: i % 2 ? ("assistant" as const) : ("user" as const), content: `m${i}` }));
    const h = historyForRequest(msgs);
    expect(h.length).toBeLessThanOrEqual(12);
    expect(h[0]?.role).toBe("user");
    expect(siteAssistantRequestSchema.safeParse({ messages: h }).success).toBe(true);
  });

  it("maps rate limits to a friendly message", () => {
    expect(friendlyError(new ApiError("RATE_LIMITED", "x", 429))).toMatch(/muchos mensajes/);
    expect(friendlyError(new Error("x"))).toMatch(/No pude responder/);
  });
});
