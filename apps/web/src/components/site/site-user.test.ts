import { beforeEach, describe, expect, it, vi } from "vitest";
import { firstName, loadSiteUser, resetSiteUser } from "./site-user";

describe("firstName", () => {
  it("uses the first word of the name", () => {
    expect(firstName({ name: "  Ana María Pérez ", email: "a@x.com" })).toBe("Ana");
  });
  it("falls back to the email local part", () => {
    expect(firstName({ name: null, email: "juan@x.com" })).toBe("juan");
    expect(firstName({ name: "  ", email: "luz@x.com" })).toBe("luz");
  });
});

describe("loadSiteUser", () => {
  beforeEach(() => resetSiteUser());
  it("calls /auth/me once and shares the result", async () => {
    const me = vi.fn().mockResolvedValue({ user: { name: "Ana", email: "a@x.com" } });
    const [a, b] = await Promise.all([loadSiteUser(me), loadSiteUser(me)]);
    expect(me).toHaveBeenCalledTimes(1);
    expect(a).toEqual({ name: "Ana", email: "a@x.com" });
    expect(b).toBe(a);
  });
  it("resolves null on failure (logged out)", async () => {
    const me = vi.fn().mockRejectedValue(new Error("401"));
    expect(await loadSiteUser(me)).toBeNull();
  });
});
