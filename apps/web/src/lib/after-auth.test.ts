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

describe("safeNextPath open-redirect hardening (CN-014)", () => {
  it.each(["/%09/evil.com", "/\t/evil.com", "//evil.com", "/\\evil.com", "https://evil.com", "/\n/evil.com", "/ok\u007f", "/a\\b"])(
    "rejects %j",
    (next) => {
      expect(safeNextPath(next)).toBeNull();
    },
  );

  it("keeps a valid same-origin path with query and hash", () => {
    expect(safeNextPath("/app/quotes?x=1#y")).toBe("/app/quotes?x=1#y");
  });
});
