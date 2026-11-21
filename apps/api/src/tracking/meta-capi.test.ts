import { describe, expect, it, vi } from "vitest";
import { buildRegistrationPayload, createMetaCapi, createMetaCapiFromEnv, hashForMeta } from "./meta-capi.js";

const event = { eventId: "evt_12345678", email: "  Ana@Example.COM ", ip: "1.2.3.4", userAgent: "UA", eventTime: 100 };

describe("meta-capi", () => {
  it("hashes trimmed lowercase emails with SHA-256", () => {
    expect(hashForMeta("  Ana@Example.COM ")).toBe(hashForMeta("ana@example.com"));
    expect(hashForMeta("a")).toBe("ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb");
  });

  it("builds a CompleteRegistration payload without the plain email", () => {
    const body = buildRegistrationPayload(event);
    expect(JSON.stringify(body)).not.toContain("example.com");
    expect(body.data[0]).toMatchObject({ event_name: "CompleteRegistration", event_id: "evt_12345678", event_time: 100 });
  });

  it("posts to the Graph API and never rejects on failure", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("boom"));
    const errors: string[] = [];
    const capi = createMetaCapi("123", "secret-token", fetchImpl as unknown as typeof fetch, (r) => errors.push(r));
    await expect(capi.sendCompleteRegistration(event)).resolves.toBeUndefined();
    expect(fetchImpl.mock.calls[0]![0]).toBe("https://graph.facebook.com/v21.0/123/events");
    expect(errors).toEqual(["Error"]);
    expect(errors.join()).not.toContain("secret-token");
  });

  it("reports non-2xx by status only", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 400 });
    const errors: string[] = [];
    await createMetaCapi("1", "t", fetchImpl as unknown as typeof fetch, (r) => errors.push(r)).sendCompleteRegistration(event);
    expect(errors).toEqual(["http_400"]);
  });

  it("is a no-op without env vars", () => {
    expect(createMetaCapiFromEnv({})).toBeNull();
    expect(createMetaCapiFromEnv({ META_PIXEL_ID: "1" })).toBeNull();
    expect(createMetaCapiFromEnv({ META_PIXEL_ID: "1", META_CAPI_TOKEN: "t" })).not.toBeNull();
  });
});
