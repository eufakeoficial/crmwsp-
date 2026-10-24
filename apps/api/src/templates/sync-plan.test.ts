import { describe, expect, it } from "vitest";
import { planTemplateSync } from "./sync-plan.js";

const remote = (o: Record<string, unknown> = {}) => ({
  externalId: "e1", name: "promo", language: "es", category: "marketing" as const, status: "approved" as const, body: "Hola", ...o,
});

describe("planTemplateSync", () => {
  it("updates changed rows, imports unknown ones and keeps lagging local rows", () => {
    const plan = planTemplateSync(
      [{ id: "a", name: "promo", language: "es", status: "pending", externalId: "e1" }, { id: "b", name: "solo_local", language: "es", status: "pending", externalId: null }],
      [remote(), remote({ name: "nueva", externalId: "e2" })],
    );
    expect(plan.updates).toEqual([{ id: "a", status: "approved", externalId: "e1" }]);
    expect(plan.inserts.map((i) => i.name)).toEqual(["nueva"]);
  });

  it("does nothing when in sync and collects rejection reasons", () => {
    const plan = planTemplateSync(
      [{ id: "a", name: "promo", language: "es", status: "rejected", externalId: "e1" }],
      [remote({ status: "rejected", reason: "INVALID_FORMAT" })],
    );
    expect(plan.updates).toEqual([]);
    expect(plan.rejections).toEqual([{ name: "promo", language: "es", reason: "INVALID_FORMAT" }]);
  });
});
