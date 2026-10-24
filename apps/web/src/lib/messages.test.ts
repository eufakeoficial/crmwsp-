import { describe, expect, it } from "vitest";
import { ApiError } from "./api";
import { errorMessage, isSubscriptionBlocked } from "./messages";

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
