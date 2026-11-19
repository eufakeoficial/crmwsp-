import { describe, expect, it } from "vitest";
import {
  REVEAL_GENERIC_ERROR_TEXT,
  REVEAL_TOO_MANY_TEXT,
  REVEAL_WRONG_PASSWORD_TEXT,
  canRevealApiKey,
  countdownLabel,
  revealErrorMessage,
  secondsLeft,
} from "./reveal-api-key";

describe("canRevealApiKey", () => {
  it("is owner only", () => {
    expect(canRevealApiKey("owner")).toBe(true);
    expect(canRevealApiKey("admin")).toBe(false);
    expect(canRevealApiKey("agent")).toBe(false);
    expect(canRevealApiKey("viewer")).toBe(false);
    expect(canRevealApiKey(undefined)).toBe(false);
  });
});

describe("revealErrorMessage", () => {
  it("maps statuses to neutral messages", () => {
    expect(revealErrorMessage({ status: 429 })).toBe(REVEAL_TOO_MANY_TEXT);
    expect(revealErrorMessage({ status: 403 })).toBe(REVEAL_WRONG_PASSWORD_TEXT);
    expect(revealErrorMessage({ status: 500, message: "boom detail" })).toBe(REVEAL_GENERIC_ERROR_TEXT);
    expect(revealErrorMessage(new Error("x"))).toBe(REVEAL_GENERIC_ERROR_TEXT);
    expect(revealErrorMessage(null)).toBe(REVEAL_GENERIC_ERROR_TEXT);
  });
});

describe("secondsLeft / countdownLabel", () => {
  it("rounds up and never goes negative", () => {
    expect(secondsLeft(30_000, 0)).toBe(30);
    expect(secondsLeft(30_000, 29_001)).toBe(1);
    expect(secondsLeft(30_000, 30_000)).toBe(0);
    expect(secondsLeft(30_000, 99_000)).toBe(0);
  });
  it("labels singular and plural", () => {
    expect(countdownLabel(1)).toBe("Se ocultará en 1 segundo");
    expect(countdownLabel(12)).toBe("Se ocultará en 12 segundos");
  });
});
