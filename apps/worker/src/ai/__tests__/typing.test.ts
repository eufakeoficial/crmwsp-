import { describe, expect, it, vi } from "vitest";
import { sendTypingIndicator, type TypingDeps, type TypingTarget } from "../typing.js";

const now = new Date("2026-11-19T12:00:00Z");
const target = (over: Partial<TypingTarget> = {}): TypingTarget => ({
  aiMode: "auto",
  assignedUserId: null,
  status: "open",
  lastInboundAt: new Date(now.getTime() - 60_000),
  inboundExternalId: "wamid.IN1",
  provider: "gupshup",
  appName: "DemoApp",
  sourcePhone: "+5491140000000",
  credentials: Buffer.from("enc-key"),
  channelStatus: "active",
  partnerAppId: "app-1",
  partnerToken: Buffer.from("enc-partner"),
  ...over,
});

function make(t: TypingTarget | null, send = vi.fn(async () => undefined)) {
  const warn = vi.fn();
  const decrypt = vi.fn((b: Buffer) => `plain:${b.toString()}`);
  const deps: TypingDeps = {
    tenantId: "t1",
    cipher: { decrypt } as never,
    provider: { name: "x", sendTypingIndicator: send } as never,
    load: async () => t,
    logger: { info: vi.fn(), warn, error: vi.fn() },
    now,
  };
  return { deps, send, warn };
}

describe("sendTypingIndicator", () => {
  it("sends with decrypted credentials and the inbound message id", async () => {
    const { deps, send } = make(target());
    await expect(sendTypingIndicator(deps)).resolves.toBe(true);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: "plain:enc-key", partnerToken: "plain:enc-partner", partnerAppId: "app-1" }),
      "wamid.IN1",
    );
  });

  it.each([
    ["aiMode is not auto", { aiMode: "suggest" }],
    ["conversation is assigned to a human", { assignedUserId: "u1" }],
    ["24h window closed", { lastInboundAt: new Date(now.getTime() - 25 * 3600_000) }],
    ["no inbound provider id", { inboundExternalId: null }],
    ["channel disabled", { channelStatus: "disabled" }],
  ])("skips when %s", async (_n, over) => {
    const { deps, send } = make(target(over as Partial<TypingTarget>));
    await expect(sendTypingIndicator(deps)).resolves.toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it("never throws and logs a warning without secrets on failure", async () => {
    const { deps, warn } = make(target(), vi.fn(async () => Promise.reject(new Error("boom sk_partner"))));
    await expect(sendTypingIndicator(deps)).resolves.toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(warn.mock.calls)).not.toContain("sk_partner");
  });
});
