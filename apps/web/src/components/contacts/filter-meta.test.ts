import { contactFilterSchema } from "@crmwsp/contracts";
import { describe, expect, it } from "vitest";
import { describeCondition, moneyCurrencies, moneyInputText, toMoneyFilterValue } from "./filter-meta";

describe("money filter values", () => {
  it("uses the currency exponent: CLP has no decimals, USD has 2", () => {
    expect(toMoneyFilterValue("15000", "CLP")).toEqual({ amountMinor: 15000, currency: "CLP" });
    expect(toMoneyFilterValue("150", "USD")).toEqual({ amountMinor: 15000, currency: "USD" });
    expect(toMoneyFilterValue("12,50", "USD")).toEqual({ amountMinor: 1250, currency: "USD" });
    expect(toMoneyFilterValue("12,5", "CLP")).toBeUndefined();
    expect(toMoneyFilterValue("abc", "USD")).toBeUndefined();
  });
  it("round-trips to the input text", () => {
    expect(moneyInputText({ amountMinor: 15000, currency: "CLP" })).toBe("15000");
    expect(moneyInputText({ amountMinor: 1250, currency: "USD" })).toBe("12.5");
  });
  it("produces values the contract accepts", () => {
    const value = toMoneyFilterValue("15000", "CLP");
    const ok = contactFilterSchema.safeParse({ match: "all", conditions: [{ field: "total_paid", type: "number", operator: "gt", value }] });
    expect(ok.success).toBe(true);
  });
  it("lists the tenant currency first and describes the chip in that currency", () => {
    expect(moneyCurrencies("CLP")[0]).toBe("CLP");
    expect(moneyCurrencies("PEN", ["USD", "PEN"], "EUR")).toEqual(["PEN", "USD", "EUR"]);
    const text = describeCondition({ field: "total_paid", type: "number", operator: "gt", value: { amountMinor: 15000, currency: "CLP" } }, { segments: [] });
    expect(text).toContain("15.000");
    expect(text).not.toContain(",00");
  });
});
