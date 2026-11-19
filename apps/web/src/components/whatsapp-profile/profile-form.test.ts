import { describe, expect, it } from "vitest";
import { photoProblem } from "../../lib/whatsapp-profile-api";
import { buildUpdate, toForm } from "./profile-form";

const profile = { about: "Hola", description: null, address: "Calle 1", email: null, website1: null, website2: null, vertical: "RETAIL", photoUrl: null };

describe("profile form", () => {
  it("sends only changed, non-empty fields", () => {
    const form = { ...toForm(profile), description: " Nueva ", about: "" };
    expect(buildUpdate(profile, form)).toEqual({ description: "Nueva" });
  });
  it("ignores unknown verticals", () => {
    expect(toForm({ ...profile, vertical: "WEIRD" }).vertical).toBe("");
  });
});

describe("photoProblem", () => {
  it("accepts jpg/png up to 5 MB only", () => {
    expect(photoProblem({ type: "image/png", size: 1000 })).toBeNull();
    expect(photoProblem({ type: "image/jpeg", size: 5 * 1024 * 1024 })).toBeNull();
    expect(photoProblem({ type: "image/webp", size: 1000 })).toMatch(/JPG o PNG/);
    expect(photoProblem({ type: "image/png", size: 5 * 1024 * 1024 + 1 })).toMatch(/5 MB/);
  });
});
