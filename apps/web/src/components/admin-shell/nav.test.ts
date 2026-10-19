import { describe, expect, it } from "vitest";
import { resolveActiveKey, searchNav } from "./nav";

describe("admin nav", () => {
  it("activates the longest match", () => {
    expect(resolveActiveKey("/app/admin")).toBe("home");
    expect(resolveActiveKey("/app/admin/tenants/42")).toBe("tenants");
    expect(resolveActiveKey("/app/inbox")).toBeNull();
  });
  it("searches ignoring accents and case", () => {
    expect(searchNav("facturacion").length).toBe(0);
    expect(searchNav("CONFIGURACION").map((i) => i.key)).toEqual(["settings"]);
    expect(searchNav("").length).toBeGreaterThan(5);
  });
});
