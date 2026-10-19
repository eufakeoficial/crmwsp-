import { describe, expect, it } from "vitest";
import { NAV_MAIN, isActive } from "./nav-items";

describe("isActive", () => {
  it("matches /app only exactly", () => {
    expect(isActive("/app", "/app")).toBe(true);
    expect(isActive("/app/inbox", "/app")).toBe(false);
  });
  it("matches nested routes by prefix", () => {
    expect(isActive("/app/inbox/123", "/app/inbox")).toBe(true);
    expect(isActive("/app/inboxes", "/app/inbox")).toBe(false);
  });
  it("has unique keys", () => {
    expect(new Set(NAV_MAIN.map((i) => i.key)).size).toBe(NAV_MAIN.length);
  });
});
