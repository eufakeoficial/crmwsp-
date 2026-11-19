import { describe, expect, it } from "vitest";
import { buildChannelHealth } from "./channel-health.js";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";

describe("buildChannelHealth", () => {
  it("combines inbound and outbound per channel and keeps the channel order", () => {
    const out = buildChannelHealth(
      [B, A, C],
      [{ channel_id: A, at: "2026-11-19T10:00:00.000Z" }],
      [
        { channel_id: A, status: "delivered", at: "2026-11-19T10:05:00.000Z", error_message: null, error_code: null },
        { channel_id: B, status: "failed", at: "2026-11-19T09:00:00.000Z", error_message: "Authentication Failed", error_code: "provider_error" },
      ],
    );
    expect(out.map((h) => h.channelId)).toEqual([B, A, C]);
    expect(out[0]).toEqual({ channelId: B, lastInboundAt: null, lastOutbound: { ok: false, at: "2026-11-19T09:00:00.000Z", error: "Authentication Failed" } });
    expect(out[1]).toEqual({ channelId: A, lastInboundAt: "2026-11-19T10:00:00.000Z", lastOutbound: { ok: true, at: "2026-11-19T10:05:00.000Z", error: null } });
    expect(out[2]).toEqual({ channelId: C, lastInboundAt: null, lastOutbound: null });
  });

  it("falls back to a code text and caps long provider messages", () => {
    const [h1, h2] = buildChannelHealth(
      [A, B],
      [],
      [
        { channel_id: A, status: "failed", at: "2026-11-19T10:00:00.000Z", error_message: null, error_code: "credentials_unavailable" },
        { channel_id: B, status: "failed", at: "2026-11-19T10:00:00.000Z", error_message: "x".repeat(500), error_code: null },
      ],
    );
    expect(h1!.lastOutbound?.error).toBe("No se pudieron leer las credenciales del canal");
    expect(h2!.lastOutbound?.error).toHaveLength(160);
  });
});
