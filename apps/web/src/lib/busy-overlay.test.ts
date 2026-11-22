import { describe, expect, it } from "vitest";
import { beginBusy, isBlockingRequest } from "./busy-overlay";

describe("isBlockingRequest", () => {
  it("never blocks reads", () => {
    expect(isBlockingRequest("GET", "/channels")).toBe(false);
  });
  it("blocks writes that are decisions", () => {
    expect(isBlockingRequest("PATCH", "/tenant")).toBe(true);
    expect(isBlockingRequest("POST", "/channels/gupshup")).toBe(true);
    expect(isBlockingRequest("DELETE", "/team/members/1")).toBe(true);
    expect(isBlockingRequest("POST", "/billing/card/checkout")).toBe(true);
  });
  it("does not block chat or notification writes", () => {
    expect(isBlockingRequest("POST", "/conversations/1/messages")).toBe(false);
    expect(isBlockingRequest("POST", "/conversations/1/media")).toBe(false);
    expect(isBlockingRequest("POST", "/notifications/read")).toBe(false);
    expect(isBlockingRequest("POST", "/auth/logout")).toBe(false);
  });
});

describe("beginBusy", () => {
  it("ending twice only counts once", () => {
    const end = beginBusy();
    end();
    expect(() => end()).not.toThrow();
  });
});
