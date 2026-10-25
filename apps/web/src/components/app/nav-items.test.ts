import { describe, expect, it } from "vitest";
import { AI_CHILDREN, AI_SECTIONS, NAV_GROUPS, NAV_SECONDARY, SETTINGS_SECTIONS, collectHrefs, containsActive, getActiveHref, groupHref, isActive } from "./nav-items";

// Every page that had a nav link before the 7-group restructure (`/app/settings` was only the group index).
const PREVIOUS_HREFS = [
  "/app", "/app/inbox", "/app/contacts", "/app/pipeline", "/app/quotes", "/app/orders", "/app/agenda", "/app/ai",
  "/app/ai/runs", "/app/ai/handoffs", "/app/ai/playbook",
  "/app/payments/reviews", "/app/analytics", "/app/broadcasts", "/app/products", "/app/channels", "/app/templates", "/app/team",
  "/app/settings/ai", "/app/settings/integrations", "/app/settings/knowledge", "/app/settings/approvals", "/app/settings/templates",
  "/app/settings/currency", "/app/settings/plan", "/app/settings/ads", "/app/settings/developers", "/app/settings/owner-mode",
  "/app/support",
];

interface KeyedNav {
  key: string;
  children?: readonly KeyedNav[] | undefined;
}

describe("isActive", () => {
  it("matches /app only exactly", () => {
    expect(isActive("/app", "/app")).toBe(true);
    expect(isActive("/app/inbox", "/app")).toBe(false);
  });
  it("matches nested routes by prefix", () => {
    expect(isActive("/app/inbox/123", "/app/inbox")).toBe(true);
    expect(isActive("/app/inboxes", "/app/inbox")).toBe(false);
  });
});

describe("NAV_GROUPS", () => {
  const all = [...NAV_GROUPS, ...NAV_SECONDARY].flatMap(collectHrefs);

  it("has exactly 7 top-level entries in order", () => {
    expect(NAV_GROUPS.map((g) => g.label)).toEqual(["Inicio", "Inbox", "Clientes", "Ventas", "Agenda", "Automatizar", "Configuración"]);
  });
  it("keeps every previously reachable route", () => {
    for (const href of PREVIOUS_HREFS) expect(all).toContain(href);
  });
  it("has unique keys and hrefs", () => {
    expect(new Set(all).size).toBe(all.length);
    const keys: string[] = [];
    const walk = (items: readonly KeyedNav[]) => items.forEach((i) => (keys.push(i.key), i.children && walk(i.children)));
    walk([...NAV_GROUPS, ...NAV_SECONDARY]);
    expect(new Set(keys).size).toBe(keys.length);
  });
  it("shows Soporte as secondary entry", () => {
    expect(NAV_SECONDARY.map((i) => i.key)).toEqual(["support"]);
  });
  it("groups pages as designed", () => {
    const labels = (k: string) => NAV_GROUPS.find((g) => g.key === k)?.children?.map((c) => c.label);
    expect(labels("clients")).toEqual(["Contactos", "Pipeline"]);
    expect(labels("sales")).toEqual(["Presupuestos", "Pedidos", "Comprobantes", "Rentabilidad"]);
    expect(labels("inbox")).toEqual(["Necesitan atención"]);
  });
  it("keeps the IA sub-links and tabs", () => {
    const ai = NAV_GROUPS.find((g) => g.key === "automate")?.children?.find((c) => c.key === "ai");
    expect(ai?.children?.map((c) => c.href)).toEqual(["/app/ai/runs", "/app/ai/playbook"]);
    expect(AI_CHILDREN.map((i) => i.href)).toContain("/app/ai/playbook");
    expect(AI_SECTIONS.map((i) => i.label)).toEqual(["Resumen", "Historial de la IA", "Necesitan atención", "Guion de ventas"]);
  });
});

describe("active helpers", () => {
  it("resolves one active href, the most specific", () => {
    expect(getActiveHref("/app/ai/handoffs")).toBe("/app/ai/handoffs");
    expect(getActiveHref("/app/ai")).toBe("/app/ai");
    expect(getActiveHref("/app/settings/ai")).toBe("/app/settings/ai");
    expect(getActiveHref("/app/products/42")).toBe("/app/products");
    expect(getActiveHref("/app/unknown")).toBeNull();
  });
  it("detects the group that contains the active page", () => {
    const g = (k: string) => NAV_GROUPS.find((x) => x.key === k)!;
    expect(containsActive(g("settings"), getActiveHref("/app/products/42"))).toBe(true);
    expect(containsActive(g("sales"), getActiveHref("/app/products/42"))).toBe(false);
    expect(containsActive(g("automate"), getActiveHref("/app/ai/runs"))).toBe(true);
    expect(containsActive(g("inbox"), getActiveHref("/app/ai/handoffs"))).toBe(true);
  });
  it("links a rail icon to the first page of each group", () => {
    expect(groupHref(NAV_GROUPS.find((g) => g.key === "clients")!)).toBe("/app/contacts");
    expect(groupHref(NAV_GROUPS.find((g) => g.key === "inbox")!)).toBe("/app/inbox");
  });
});

describe("SETTINGS_SECTIONS (F9)", () => {
  it("has the owner-mode section exactly once and no duplicated routes", () => {
    expect(SETTINGS_SECTIONS.filter((s) => s.label === "Gestionar desde tu WhatsApp")).toHaveLength(1);
    expect(new Set(SETTINGS_SECTIONS.map((s) => s.href)).size).toBe(SETTINGS_SECTIONS.length);
  });
});
