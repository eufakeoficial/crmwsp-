import { describe, expect, it } from "vitest";
import { channelCredentialsNotification, isProviderAuthError } from "../notifications/channel-credentials.js";

const ID = "11111111-1111-4111-8111-111111111111";

describe("channel credentials alert", () => {
  it("triggers only for provider 401/403", () => {
    expect(isProviderAuthError({ provider: "gupshup", status: 401 })).toBe(true);
    expect(isProviderAuthError({ provider: "gupshup", status: 403 })).toBe(true);
    expect(isProviderAuthError({ provider: "gupshup", status: 500 })).toBe(false);
    expect(isProviderAuthError({ status: 401 })).toBe(false);
    expect(isProviderAuthError(new Error("x"))).toBe(false);
    expect(isProviderAuthError(null)).toBe(false);
  });

  it("dedupes within a 6 hour bucket and re-alerts after it", () => {
    const at = (iso: string) => channelCredentialsNotification(ID, new Date(iso)).dedupeKey;
    expect(at("2026-11-19T06:00:00.000Z")).toBe(at("2026-11-19T11:59:00.000Z"));
    expect(at("2026-11-19T11:59:00.000Z")).not.toBe(at("2026-11-19T12:00:00.000Z"));
    expect(channelCredentialsNotification("22222222-2222-4222-8222-222222222222", new Date()).dedupeKey).not.toBe(at("2026-11-19T06:00:00.000Z"));
    expect(channelCredentialsNotification(ID, new Date())).toMatchObject({ kind: "channel_credentials", entity: "channel_connection", entityId: ID });
  });
});
