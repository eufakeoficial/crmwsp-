import { SUPPORT_TICKET_CATEGORIES, SUPPORT_TICKET_PRIORITIES, SUPPORT_TICKET_STATUSES } from "@crmwsp/contracts";
import { describe, expect, it } from "vitest";
import { SUPPORT_CATEGORY_LABELS, SUPPORT_PRIORITY_LABELS, SUPPORT_STATUS_LABELS, renderCannedResponse } from "./support-api";

describe("support labels", () => {
  it("label every status, category and priority in Spanish", () => {
    expect(SUPPORT_TICKET_STATUSES.map((s) => SUPPORT_STATUS_LABELS[s])).toEqual(["Abierto", "En curso", "Esperando cliente", "Resuelto"]);
    expect(SUPPORT_TICKET_CATEGORIES.map((c) => SUPPORT_CATEGORY_LABELS[c])).toEqual(["Facturación", "WhatsApp", "IA", "Error", "Otro"]);
    expect(SUPPORT_TICKET_PRIORITIES.every((p) => SUPPORT_PRIORITY_LABELS[p].length > 0)).toBe(true);
  });
});

describe("renderCannedResponse (web mirror of the domain rule)", () => {
  it("expands known variables and keeps unknown ones", () => {
    expect(renderCannedResponse("Hola {{nombre}} de {{ negocio }}, {{x}}", { nombre: "Ana", negocio: "Dental Sur" })).toBe("Hola Ana de Dental Sur, {{x}}");
  });
  it("does not re-expand values", () => {
    expect(renderCannedResponse("{{asunto}}", { asunto: "{{nombre}}", nombre: "Ana" })).toBe("{{nombre}}");
  });
});
