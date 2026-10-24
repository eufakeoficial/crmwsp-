import { describe, expect, it } from "vitest";
import { ApiError } from "./api";
import { errorMessage, isSetupRequired, isSubscriptionBlocked } from "./messages";

const planErr = (reason: string, extra: Record<string, unknown> = {}) =>
  new ApiError("PLAN_LIMIT_EXCEEDED", "x", 402, { reason, ...extra });

describe("errorMessage for 402 subscription states (F3)", () => {
  it("explains a lapsed subscription in Spanish", () => {
    expect(errorMessage(planErr("subscription_restricted"))).toMatch(/suscripción venció.*solo lectura/);
    expect(isSubscriptionBlocked(planErr("subscription_restricted"))).toBe(true);
  });

  it("explains a number that already used its trial", () => {
    expect(errorMessage(planErr("trial_already_used"))).toMatch(/ya usó su prueba gratis/);
    expect(isSubscriptionBlocked(planErr("trial_already_used"))).toBe(true);
  });

  it("keeps the generic copy for other limits", () => {
    expect(errorMessage(new ApiError("PLAN_LIMIT_EXCEEDED", "x", 402))).toMatch(/Tu plan no permite/);
    expect(isSubscriptionBlocked(planErr("limit_reached"))).toBe(false);
  });
});

describe("setup mode and contact import copy (F5)", () => {
  it("maps SETUP_REQUIRED to the Spanish setup message pointing to Canales", () => {
    const err = new ApiError("SETUP_REQUIRED", "x", 402, { reason: "setup_required" });
    expect(errorMessage(err)).toBe("Conecta tu WhatsApp para empezar tu prueba. Ve a Canales para conectarlo.");
    expect(isSetupRequired(err)).toBe(true);
  });

  it("localizes the contact import over-limit error from details", () => {
    const err = new ApiError("PLAN_LIMIT_EXCEEDED", "x", 402, { key: "contacts", reason: "limit_reached", limit: 500, used: 498, requested: 5, remaining: 2 });
    expect(errorMessage(err)).toBe("El archivo agrega 5 contactos nuevos, pero tu plan permite 2 más (límite 500). No se importó nada.");
  });
});
