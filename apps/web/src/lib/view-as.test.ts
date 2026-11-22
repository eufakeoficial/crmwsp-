import { describe, expect, it } from "vitest";
import { canViewAsMember } from "./view-as";

describe("canViewAsMember", () => {
  it("lets an owner view admin, agent and viewer but not another owner or oneself", () => {
    expect(canViewAsMember("owner", { userId: "b", role: "admin" }, "a")).toBe(true);
    expect(canViewAsMember("owner", { userId: "b", role: "agent" }, "a")).toBe(true);
    expect(canViewAsMember("owner", { userId: "b", role: "viewer" }, "a")).toBe(true);
    expect(canViewAsMember("owner", { userId: "b", role: "owner" }, "a")).toBe(false);
    expect(canViewAsMember("owner", { userId: "a", role: "agent" }, "a")).toBe(false);
  });

  it("lets an admin view only agent and viewer", () => {
    expect(canViewAsMember("admin", { userId: "b", role: "agent" }, "a")).toBe(true);
    expect(canViewAsMember("admin", { userId: "b", role: "viewer" }, "a")).toBe(true);
    expect(canViewAsMember("admin", { userId: "b", role: "admin" }, "a")).toBe(false);
    expect(canViewAsMember("admin", { userId: "b", role: "owner" }, "a")).toBe(false);
  });

  it("refuses non-managers", () => {
    expect(canViewAsMember("agent", { userId: "b", role: "viewer" }, "a")).toBe(false);
    expect(canViewAsMember(undefined, { userId: "b", role: "viewer" }, "a")).toBe(false);
  });
});
