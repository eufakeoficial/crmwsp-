import { describe, expect, it } from "vitest";
import { ADMIN_ITEMS, resolveActiveKey, searchNav } from "./nav";

describe("admin nav", () => {
  it("activates the longest match", () => {
    expect(resolveActiveKey("/app/admin")).toBe("home");
    expect(resolveActiveKey("/app/admin/tenants/42")).toBe("tenants");
    expect(resolveActiveKey("/app/inbox")).toBeNull();
  });
  it("lists only sections that have a page", () => {
    expect(ADMIN_ITEMS.map((i) => i.key)).toEqual(["home", "tenants", "approvals", "users", "channels", "payments", "plans", "usage", "audit", "settings"]);
  });
  it("searches ignoring accents and case", () => {
    expect(searchNav("facturacion").length).toBe(0);
    expect(searchNav("CONFIGURACION").map((i) => i.key)).toEqual(["settings"]);
    expect(searchNav("").length).toBeGreaterThan(5);
  });
});
