import { describe, expect, it } from "vitest";
import { computeHubStatus } from "./ai-hub-status";

describe("computeHubStatus", () => {
  it("is all off with no data", () => {
    const s = computeHubStatus({ connection: undefined, sources: undefined, voice: undefined, owner: undefined });
    expect(Object.values(s).every((v) => !v)).toBe(true);
  });
  it("reads connection, voice and owner phone", () => {
    const s = computeHubStatus({
      connection: {} as never,
      sources: [{} as never],
      voice: { hasApiKey: true, voiceId: "abc" } as never,
      owner: { phone: { status: "verified" }, aiPaused: false } as never,
    });
    expect(s).toEqual({ sources: true, quotes: true, orders: true, voice: true, simulator: true, owner: true });
  });
  it("pending owner phone is not active", () => {
    const s = computeHubStatus({ connection: null, sources: [], voice: undefined, owner: { phone: { status: "pending" }, aiPaused: false } as never });
    expect(s.owner).toBe(false);
    expect(s.quotes).toBe(false);
  });
});
