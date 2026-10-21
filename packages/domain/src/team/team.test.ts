import { describe, expect, it } from "vitest";
import { canChangeRole, canInvite, canManageInvitation, canRemoveMember, sameEmail } from "./index.js";

describe("team rules", () => {
  it("only owner invites admins; nobody invites owners; agents/viewers cannot invite", () => {
    expect(canInvite("owner", "admin").allowed).toBe(true);
    expect(canInvite("admin", "agent").allowed).toBe(true);
    expect(canInvite("admin", "admin")).toEqual({ allowed: false, reason: "only_owner_grants_admin" });
    expect(canInvite("owner", "owner")).toEqual({ allowed: false, reason: "owner_not_invitable" });
    expect(canInvite("agent", "viewer")).toEqual({ allowed: false, reason: "not_a_manager" });
    expect(canInvite("viewer", "viewer").allowed).toBe(false);
    expect(canManageInvitation("admin", "admin").allowed).toBe(false);
  });

  it("protects the last owner on role change and removal", () => {
    expect(canChangeRole({ actor: "owner", current: "owner", next: "admin", ownerCount: 1 })).toEqual({ allowed: false, reason: "last_owner" });
    expect(canChangeRole({ actor: "owner", current: "owner", next: "admin", ownerCount: 2 }).allowed).toBe(true);
    expect(canRemoveMember({ actor: "owner", target: "owner", ownerCount: 1 })).toEqual({ allowed: false, reason: "last_owner" });
    expect(canRemoveMember({ actor: "owner", target: "owner", ownerCount: 2 }).allowed).toBe(true);
  });

  it("admins cannot modify owners nor grant owner/admin", () => {
    expect(canChangeRole({ actor: "admin", current: "owner", next: "agent", ownerCount: 3 })).toEqual({ allowed: false, reason: "cannot_modify_owner" });
    expect(canChangeRole({ actor: "admin", current: "agent", next: "owner", ownerCount: 1 })).toEqual({ allowed: false, reason: "only_owner_grants_owner" });
    expect(canChangeRole({ actor: "admin", current: "agent", next: "admin", ownerCount: 1 })).toEqual({ allowed: false, reason: "only_owner_grants_admin" });
    expect(canChangeRole({ actor: "admin", current: "viewer", next: "agent", ownerCount: 1 }).allowed).toBe(true);
    expect(canRemoveMember({ actor: "admin", target: "owner", ownerCount: 3 })).toEqual({ allowed: false, reason: "cannot_modify_owner" });
    expect(canRemoveMember({ actor: "agent", target: "viewer", ownerCount: 1 }).allowed).toBe(false);
    expect(canChangeRole({ actor: "owner", current: "agent", next: "owner", ownerCount: 1 }).allowed).toBe(true);
  });

  it("compares emails case-insensitively", () => {
    expect(sameEmail(" Ana@Example.com", "ana@example.com")).toBe(true);
    expect(sameEmail("ana@example.com", "ana@example.org")).toBe(false);
  });
});
