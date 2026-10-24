import { describe, expect, it } from "vitest";
import { PLANS } from "../../../../../packages/billing/src/index";
import { MARKET_FOOTNOTE, MARKET_ROWS, PRICING_PLANS } from "./pricing-content";

describe("landing pricing", () => {
  it("mirrors packages/billing plan prices and limits", () => {
    for (const p of PRICING_PLANS) {
      const plan = PLANS[p.id];
      expect(p.priceMonthlyUsd).toBe(plan.priceMonthlyUsd);
      expect(p.priceAnnualUsd).toBe(plan.priceAnnualUsd);
      expect(p.seats).toBe(plan.limits.seats);
      expect(p.whatsappNumbers).toBe(plan.limits.whatsapp_numbers);
      expect(p.contacts).toBe(plan.limits.contacts);
      expect(p.broadcasts ?? 0).toBe(plan.limits.broadcast_sends);
    }
  });
  it("annual price is 10 months", () => {
    for (const p of PRICING_PLANS) expect(p.priceAnnualUsd).toBe(p.priceMonthlyUsd * 10);
  });
  it("never mentions taxes", () => {
    const text = JSON.stringify([PRICING_PLANS, MARKET_ROWS, MARKET_FOOTNOTE]);
    expect(text).not.toMatch(/impuesto|iva\b|tax/i);
  });
});
