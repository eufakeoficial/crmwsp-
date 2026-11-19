import { describe, expect, it } from "vitest";
import { ownerPhoneE164Schema } from "../owner-mode.js";

describe("ownerPhoneE164Schema normalization", () => {
  it("accepts spaces, dashes and parentheses and returns strict E.164", () => {
    expect(ownerPhoneE164Schema.parse(" +51 906-109 195 ")).toBe("+51906109195");
    expect(ownerPhoneE164Schema.parse("+1 (415) 555-2671")).toBe("+14155552671");
  });
  it("still rejects numbers without the + country prefix", () => {
    expect(ownerPhoneE164Schema.safeParse("906109195").success).toBe(false);
  });
});
