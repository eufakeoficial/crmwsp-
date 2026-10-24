import { describe, expect, it } from "vitest";
import { PLANS } from "../index.js";

/**
 * The database verifies the list price of every charge (migration 0094,
 * `subscription_plan_list_price`). Changing a price here REQUIRES a new migration that updates
 * that SQL function, or every new charge is refused with "list price mismatch".
 */
describe("plan prices mirrored in SQL (0094)", () => {
  it("match subscription_plan_list_price", () => {
    expect([PLANS.start.priceMonthlyUsd, PLANS.start.priceAnnualUsd, PLANS.pro.priceMonthlyUsd, PLANS.pro.priceAnnualUsd]).toEqual([49, 490, 89, 890]);
  });
});
