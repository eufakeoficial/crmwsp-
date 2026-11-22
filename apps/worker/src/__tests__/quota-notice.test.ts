import { describe, expect, it } from "vitest";
import { LlmProviderError } from "@crmwsp/ai";
import { isInsufficientQuota, quotaNotification } from "../ai/quota-notice.js";

const ID = "11111111-1111-4111-8111-111111111111";

describe("quota notice", () => {
  it("detects only the insufficient_quota failure", () => {
    expect(isInsufficientQuota(new LlmProviderError("x", false, 429, "insufficient_quota"))).toBe(true);
    expect(isInsufficientQuota(new LlmProviderError("x", true, 429))).toBe(false);
    expect(isInsufficientQuota(new Error("insufficient_quota"))).toBe(false);
  });

  it("builds a tenant-visible OpenAI notification, deduplicated per connection and day", () => {
    const n = quotaNotification({ id: ID, provider: "openai" }, new Date("2026-11-19T15:30:00.000Z"));
    expect(n).toMatchObject({
      kind: "ai_credentials",
      title: "Tu clave de OpenAI se quedó sin saldo",
      entity: "llm_connection",
      entityId: ID,
      dedupeKey: `ai_quota:${ID}:2026-11-19`,
    });
    expect(quotaNotification({ id: ID, provider: "custom" }, new Date("2026-11-19T00:00:00.000Z")).title).toBe("Tu clave de IA se quedó sin saldo");
  });
});
