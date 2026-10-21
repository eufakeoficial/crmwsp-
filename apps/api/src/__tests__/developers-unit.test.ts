import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { hashApiKey } from "../developers/api-key.guard.js";
import { assertWebhookUrl } from "../developers/developers.controller.js";

describe("developer platform helpers", () => {
  it("hashes API keys with SHA-256 (32 bytes, as resolve_api_key expects)", () => {
    const h = hashApiKey("crm_live_x");
    expect(h).toHaveLength(32);
    expect(h.equals(createHash("sha256").update("crm_live_x").digest())).toBe(true);
  });

  it("rejects private webhook targets at registration", () => {
    expect(() => assertWebhookUrl("https://169.254.169.254/latest/meta-data")).toThrow(/private_host/);
    expect(() => assertWebhookUrl("https://localhost:8443/x")).toThrow(/private_host/);
    expect(() => assertWebhookUrl("https://hooks.example.com/x")).not.toThrow();
  });
});
