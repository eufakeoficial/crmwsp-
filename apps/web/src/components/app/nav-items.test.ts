import { describe, expect, it } from "vitest";
import { AI_CHILDREN, AI_SECTIONS, NAV_MAIN, NAV_MORE, NAV_SECONDARY, isActive, isMoreActive } from "./nav-items";

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
  it("keeps the daily items visible and the rest under Más", () => {
    expect(NAV_MAIN.map((i) => i.label)).toEqual(["Inicio", "Inbox", "Contactos", "Pipeline", "Presupuestos", "Pedidos", "Agenda", "IA"]);
    expect(NAV_MORE.map((i) => i.label)).toEqual(["Comprobantes", "Rentabilidad", "Campañas", "Productos", "Canales", "Equipo"]);
  });
  it("has unique keys and hrefs across every group", () => {
    const all = [...NAV_MAIN, ...NAV_MORE, ...NAV_SECONDARY];
    expect(new Set(all.map((i) => i.key)).size).toBe(all.length);
    expect(new Set(all.map((i) => i.href)).size).toBe(all.length);
  });
  it("detects when the active route is inside Más", () => {
    expect(isMoreActive("/app/products/42")).toBe(true);
    expect(isMoreActive("/app/payments/reviews")).toBe(true);
    expect(isMoreActive("/app/inbox")).toBe(false);
  });
  it("lists the sales playbook as a child of IA, in the sidebar and in the IA tabs", () => {
    expect(NAV_MAIN.find((i) => i.key === "ai")?.children).toBe(AI_CHILDREN);
    expect(AI_CHILDREN.map((i) => i.href)).toContain("/app/ai/playbook");
    expect(AI_SECTIONS.map((i) => i.label)).toEqual(["Resumen", "Ejecuciones", "Necesitan atención", "Playbook de ventas"]);
  });
});
