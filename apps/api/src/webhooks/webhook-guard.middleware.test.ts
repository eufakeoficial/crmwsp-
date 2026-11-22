import { describe, expect, it } from "vitest";
import { perTokenCapFor, requestPath } from "./webhook-guard.middleware.js";

describe("requestPath", () => {
  it("prefers originalUrl, which keeps the full path when middie strips the mount prefix", () => {
    expect(requestPath({ url: "/", originalUrl: "/webhooks/gupshup/abc123?x=1" })).toBe("/webhooks/gupshup/abc123");
  });

  it("falls back to url when originalUrl is absent", () => {
    expect(requestPath({ url: "/webhooks/gupshup/abc123?x=1" })).toBe("/webhooks/gupshup/abc123");
  });

  it("gives different tokens different keys and lets the weakAuth cap apply", () => {
    const a = requestPath({ url: "/", originalUrl: "/webhooks/commerce/gumroad/tokA" });
    const b = requestPath({ url: "/", originalUrl: "/webhooks/commerce/gumroad/tokB" });
    expect(a.split("/").pop()).toBe("tokA");
    expect(b.split("/").pop()).toBe("tokB");
    expect(perTokenCapFor(a)).toBeDefined();
  });
});
