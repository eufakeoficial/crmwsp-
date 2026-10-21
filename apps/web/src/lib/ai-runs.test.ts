import { describe, expect, it } from "vitest";
import { reasonLabel, waitingLabel } from "./ai-runs";

describe("reasonLabel", () => {
  it("translates known codes and keeps unknown reasons", () => {
    expect(reasonLabel("budget_exceeded")).toBe("Presupuesto de IA agotado");
    expect(reasonLabel("provider_error_429")).toBe("Error del proveedor de IA (429)");
    expect(reasonLabel("low confidence")).toBe("low confidence");
    expect(reasonLabel(null)).toBe("Sin motivo registrado");
  });
});

describe("waitingLabel", () => {
  const now = new Date("2026-10-21T12:00:00Z");
  it("formats minutes, hours and days", () => {
    expect(waitingLabel("2026-10-21T11:59:40Z", now)).toBe("menos de 1 min");
    expect(waitingLabel("2026-10-21T11:55:00Z", now)).toBe("5 min");
    expect(waitingLabel("2026-10-21T09:50:00Z", now)).toBe("2 h 10 min");
    expect(waitingLabel("2026-10-18T12:00:00Z", now)).toBe("3 d");
  });
});
