import { describe, expect, it } from "vitest";
import {
  domainEventSchema,
  e164PhoneSchema,
  isoDateTimeSchema,
  moneySchema,
  paginationQuerySchema,
  paginatedSchema,
  tenantIdSchema,
} from "../index.js";
import { z } from "zod";

describe("e164PhoneSchema", () => {
  it.each(["+34600111222", "+14155552671", "+521234567890"])("accepts %s", (v) => {
    expect(e164PhoneSchema.safeParse(v).success).toBe(true);
  });
  it.each(["34600111222", "+0123456789", "+34 600 111 222", "+1", "+1234567890123456", "", "+34abc"])(
    "rejects %s",
    (v) => {
      expect(e164PhoneSchema.safeParse(v).success).toBe(false);
    },
  );
});

describe("moneySchema", () => {
  it("accepts integer minor units", () => {
    expect(moneySchema.safeParse({ amountMinor: 1999, currency: "EUR" }).success).toBe(true);
    expect(moneySchema.safeParse({ amountMinor: 0, currency: "USD" }).success).toBe(true);
  });
  it("rejects decimals, negatives and bad currency", () => {
    expect(moneySchema.safeParse({ amountMinor: 19.99, currency: "EUR" }).success).toBe(false);
    expect(moneySchema.safeParse({ amountMinor: -1, currency: "EUR" }).success).toBe(false);
    expect(moneySchema.safeParse({ amountMinor: 1, currency: "eur" }).success).toBe(false);
  });
});

describe("paginationQuerySchema", () => {
  it("defaults limit to 25", () => {
    expect(paginationQuerySchema.parse({})).toEqual({ limit: 25 });
  });
  it("coerces query strings and enforces 1-100", () => {
    expect(paginationQuerySchema.parse({ limit: "50" }).limit).toBe(50);
    expect(paginationQuerySchema.safeParse({ limit: 0 }).success).toBe(false);
    expect(paginationQuerySchema.safeParse({ limit: 101 }).success).toBe(false);
  });
});

describe("paginatedSchema / domainEventSchema", () => {
  it("wraps items with nextCursor", () => {
    const s = paginatedSchema(z.string());
    expect(s.parse({ items: ["a"], nextCursor: null })).toEqual({ items: ["a"], nextCursor: null });
  });
  it("builds the event envelope", () => {
    const s = domainEventSchema("x.happened", z.object({ n: z.number() }));
    const id = "123e4567-e89b-42d3-a456-426614174000";
    const ok = s.safeParse({ id, type: "x.happened", tenantId: id, occurredAt: "2026-01-01T00:00:00Z", payload: { n: 1 } });
    expect(ok.success).toBe(true);
    expect(s.safeParse({ id, type: "other", tenantId: id, occurredAt: "2026-01-01T00:00:00Z", payload: { n: 1 } }).success).toBe(false);
  });
});

describe("edge cases", () => {
  it("e164: accepts exactly 15 digits, rejects 16", () => {
    expect(e164PhoneSchema.safeParse("+123456789012345").success).toBe(true);
    expect(e164PhoneSchema.safeParse("+1234567890123456").success).toBe(false);
  });
  it("money: rejects lowercase/short/long currency, string amount and unsafe floats", () => {
    for (const currency of ["eur", "Eur", "EU", "EURO"]) {
      expect(moneySchema.safeParse({ amountMinor: 1, currency }).success).toBe(false);
    }
    expect(moneySchema.safeParse({ amountMinor: "100", currency: "EUR" }).success).toBe(false);
    expect(moneySchema.safeParse({ amountMinor: Number.NaN, currency: "EUR" }).success).toBe(false);
  });
  it("pagination: rejects non-integer and non-numeric limit", () => {
    expect(paginationQuerySchema.safeParse({ limit: "1.5" }).success).toBe(false);
    expect(paginationQuerySchema.safeParse({ limit: "abc" }).success).toBe(false);
    expect(paginationQuerySchema.parse({ limit: "100" }).limit).toBe(100);
  });
  it("tenantId: rejects non-uuid; occurredAt: accepts offset, rejects naive datetime", () => {
    const id = "123e4567-e89b-42d3-a456-426614174000";
    expect(tenantIdSchema.safeParse("not-a-uuid").success).toBe(false);
    expect(tenantIdSchema.safeParse(id).success).toBe(true);
    expect(isoDateTimeSchema.safeParse("2026-01-01T00:00:00+02:00").success).toBe(true);
    expect(isoDateTimeSchema.safeParse("2026-01-01T00:00:00").success).toBe(false);
    expect(isoDateTimeSchema.safeParse("2026-01-01").success).toBe(false);
  });
});
