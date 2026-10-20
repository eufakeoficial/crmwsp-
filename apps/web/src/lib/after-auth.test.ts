import { describe, expect, it } from "vitest";
import { postAuthDestination, safeNextPath } from "./after-auth";

describe("postAuthDestination", () => {
  it("sends platform admins to the backoffice without next", () => {
    expect(postAuthDestination("/app/inbox", { isPlatformAdmin: true })).toBe("/app/admin");
  });
  it("honors an explicit next", () => {
    expect(postAuthDestination("/app/inbox", { next: "/app/quotes", isPlatformAdmin: true })).toBe("/app/quotes");
  });
  it("keeps the default for regular users", () => {
    expect(postAuthDestination("/app/inbox", { isPlatformAdmin: false })).toBe("/app/inbox");
  });
  it("rejects open redirects", () => {
    expect(safeNextPath("//evil.com")).toBeNull();
    expect(safeNextPath("https://evil.com")).toBeNull();
    expect(safeNextPath("/" + "\\" + "evil.com")).toBeNull();
  });
});
