import { describe, expect, it } from "vitest";
import { channelHealthText, walletBalanceText } from "./channel-health";

const now = new Date("2026-11-19T12:00:00.000Z");
const ID = "11111111-1111-4111-8111-111111111111";

describe("channelHealthText", () => {
  it("describes the last inbound time and a failed send with the provider error", () => {
    const t = channelHealthText(
      { channelId: ID, lastInboundAt: "2026-11-19T11:55:00.000Z", lastOutbound: { ok: false, at: "2026-11-19T11:50:00.000Z", error: "Authentication Failed" } },
      now,
    );
    expect(t.inbound).toBe("Último mensaje recibido: hace 5 min");
    expect(t.outbound).toEqual({ ok: false, error: "Authentication Failed", when: "hace 10 min" });
  });

  it("handles no inbound and no outbound yet", () => {
    const t = channelHealthText({ channelId: ID, lastInboundAt: null, lastOutbound: null }, now);
    expect(t.inbound).toBe("Aún no has recibido mensajes por este número");
    expect(t.outbound).toBeNull();
  });
});

describe("walletBalanceText", () => {
  it("formats the balance and hides it when unavailable", () => {
    expect(walletBalanceText({ status: "ok", amount: 3.5, currency: "USD", low: false })).toBe("Saldo Gupshup: USD 3.50");
    expect(walletBalanceText({ status: "ok", amount: 12, currency: null, low: false })).toBe("Saldo Gupshup: 12.00");
    expect(walletBalanceText({ status: "unavailable" })).toBeNull();
  });
});
