import { describe, expect, it } from "vitest";
import { newObjectionId, objectionLabel, share } from "./playbook";

describe("playbook helpers", () => {
  it("builds readable labels from objection ids", () => {
    expect(objectionLabel("es-caro")).toBe("Es caro");
    expect(objectionLabel("lo-voy-a-pensar")).toBe("Lo voy a pensar");
  });
  it("derives unique, contract-valid ids from the trigger", () => {
    const id = newObjectionId("¿Tienen garantía?", []);
    expect(id).toBe("tienen-garantia");
    expect(id).toMatch(/^[a-z0-9_-]{1,40}$/);
    expect(newObjectionId("¿Tienen garantía?", ["tienen-garantia"])).toBe("tienen-garantia-2");
    expect(newObjectionId("???", [])).toMatch(/^[a-z0-9_-]{1,40}$/);
  });
  it("formats shares safely", () => {
    expect(share(3, 10)).toBe("3 (30 %)");
    expect(share(0, 0)).toBe("—");
  });
});
