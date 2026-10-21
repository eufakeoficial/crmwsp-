import type { Opportunity, Stage } from "@crmwsp/contracts";
import { describe, expect, it } from "vitest";
import { canMoveOpportunities, columnTotal, groupByStage } from "./pipeline-meta";

const stage = (id: string, position: number): Stage => ({ id, key: id, name: id, position, kind: "open" });
const opp = (id: string, stageId: string, valueMinor: number | null, currency = "EUR"): Opportunity =>
  ({ id, stageId, valueMinor, currency }) as Opportunity;

describe("pipeline-meta", () => {
  it("groups by stage and ignores unknown stages", () => {
    const g = groupByStage([stage("a", 0), stage("b", 1)], [opp("1", "a", 1), opp("2", "b", 2), opp("3", "zzz", 3)]);
    expect(g.get("a")?.map((o) => o.id)).toEqual(["1"]);
    expect(g.get("b")?.map((o) => o.id)).toEqual(["2"]);
  });
  it("totals a single-currency column and skips mixed ones", () => {
    expect(columnTotal([opp("1", "a", 100), opp("2", "a", null)])).toEqual({ currency: "EUR", minor: 100 });
    expect(columnTotal([opp("1", "a", 100), opp("2", "a", 5, "USD")])).toBeNull();
    expect(columnTotal([])).toBeNull();
  });
  it("only write roles move cards", () => {
    expect(canMoveOpportunities("agent")).toBe(true);
    expect(canMoveOpportunities("viewer")).toBe(false);
  });
});
