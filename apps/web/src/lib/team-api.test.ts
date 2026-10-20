import { describe, expect, it } from "vitest";
import { ApiError } from "./api";
import { acceptErrorMessage, teamErrorMessage } from "./team-api";

describe("team error messages", () => {
  it("explains the seat limit and role rules in Spanish", () => {
    expect(teamErrorMessage(new ApiError("PLAN_LIMIT_EXCEEDED", "x", 402))).toMatch(/puestos/);
    expect(teamErrorMessage(new ApiError("FORBIDDEN", "x", 403))).toMatch(/propietario/);
  });

  it("maps accept failures (expired, wrong email, existing account)", () => {
    expect(acceptErrorMessage(new ApiError("NOT_FOUND", "x", 404))).toMatch(/caducado/);
    expect(acceptErrorMessage(new ApiError("FORBIDDEN", "x", 403))).toMatch(/otro correo/);
    expect(acceptErrorMessage(new ApiError("UNAUTHORIZED", "x", 401))).toMatch(/inicia sesión/);
  });
});
