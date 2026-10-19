import { describe, expect, it } from "vitest";
import { canManageChannels } from "./roles";

describe("canManageChannels", () => {
  it("allows owner and admin only", () => {
    expect(canManageChannels("owner")).toBe(true);
    expect(canManageChannels("admin")).toBe(true);
    expect(canManageChannels("agent")).toBe(false);
    expect(canManageChannels("viewer")).toBe(false);
    expect(canManageChannels(undefined)).toBe(false);
  });
});
