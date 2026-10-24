import { describe, expect, it } from "vitest";
import { canBook, canManageAgenda, canManageChannels } from "./roles";

describe("agenda roles", () => {
  it("lets owner and admin configure, and agents also book, but never viewers", () => {
    expect(canManageAgenda("admin")).toBe(true);
    expect(canManageAgenda("agent")).toBe(false);
    expect(canBook("agent")).toBe(true);
    expect(canBook("viewer")).toBe(false);
    expect(canBook(undefined)).toBe(false);
  });
});

describe("canManageChannels", () => {
  it("allows owner and admin only", () => {
    expect(canManageChannels("owner")).toBe(true);
    expect(canManageChannels("admin")).toBe(true);
    expect(canManageChannels("agent")).toBe(false);
    expect(canManageChannels("viewer")).toBe(false);
    expect(canManageChannels(undefined)).toBe(false);
  });
});
