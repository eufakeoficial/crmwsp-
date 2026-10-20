import { contactFilterSchema, type ContactFilter, type FilterCondition } from "@crmwsp/contracts";
import { renderSql } from "@crmwsp/db";
import { describe, expect, it } from "vitest";
import { compileCondition, compileContactFilter, likeEscape } from "./filter-sql.js";

const now = new Date("2026-10-20T12:00:00.000Z");
const ctx = { segments: new Map<string, ContactFilter>(), now };
const render = (c: FilterCondition) => renderSql(compileCondition(c, ctx));
const valid = (c: unknown) => contactFilterSchema.safeParse({ match: "all", conditions: [c] }).success;

describe("contact filter schema", () => {
  it("rejects unknown fields, raw column names and mismatched types/operators", () => {
    expect(valid({ field: "phone_e164", type: "text", operator: "is", value: "x" })).toBe(false);
    expect(valid({ field: "name", type: "number", operator: "eq", value: 1 })).toBe(false);
    expect(valid({ field: "name", type: "text", operator: "gt", value: "x" })).toBe(false);
    expect(valid({ field: "cf:Bad-Key", type: "text", operator: "is", value: "x" })).toBe(false);
    expect(valid({ field: "marketing_consent", type: "relation", operator: "is", value: ["maybe"] })).toBe(false);
    expect(valid({ field: "segment", type: "relation", operator: "is", value: ["not-a-uuid"] })).toBe(false);
  });
  it("enforces value shapes and limits", () => {
    expect(valid({ field: "name", type: "text", operator: "is" })).toBe(false);
    expect(valid({ field: "name", type: "text", operator: "is", value: "x".repeat(201) })).toBe(false);
    expect(valid({ field: "name", type: "text", operator: "is_unknown" })).toBe(true);
    expect(valid({ field: "created_at", type: "date", operator: "less_than_ago", value: { amount: 0, unit: "days" } })).toBe(false);
    expect(valid({ field: "created_at", type: "date", operator: "after", value: "not a date" })).toBe(false);
    const many = Array.from({ length: 21 }, () => ({ field: "name", type: "text", operator: "has_any" }));
    expect(contactFilterSchema.safeParse({ match: "all", conditions: many }).success).toBe(false);
  });
});

describe("compileCondition (text)", () => {
  const ops = {
    is: "lower(\"contacts\".\"name\") = lower($1)",
    is_not: "coalesce(lower(\"contacts\".\"name\"), '') <> lower($1)",
    contains: "\"contacts\".\"name\" ilike $1",
    not_contains: "coalesce(\"contacts\".\"name\", '') not ilike $1",
    starts_with: "\"contacts\".\"name\" ilike $1",
    has_any: "coalesce(\"contacts\".\"name\", '') <> ''",
    is_unknown: "coalesce(\"contacts\".\"name\", '') = ''",
  } as const;
  for (const [operator, expected] of Object.entries(ops)) {
    it(operator, () => {
      const q = render({ field: "name", type: "text", operator, value: "Ana" });
      expect(q.sql).toBe(expected);
    });
  }

  it("binds injection attempts as parameters and escapes LIKE wildcards", () => {
    const evil = "'; drop table contacts; --";
    const q1 = render({ field: "name", type: "text", operator: "is", value: evil });
    expect(q1.sql).not.toContain("drop");
    expect(q1.params).toEqual([evil]);
    const q2 = render({ field: "name", type: "text", operator: "contains", value: "50%_off\\" });
    expect(q2.params).toEqual(["%50\\%\\_off\\\\%"]);
    const q3 = render({ field: "phone", type: "text", operator: "starts_with", value: "+34%" });
    expect(q3.params).toEqual(["+34\\%%"]);
    expect(likeEscape("a_b%c")).toBe("a\\_b\\%c");
  });

  it("custom fields read extracted with the key as a parameter", () => {
    const q = render({ field: "cf:city", type: "text", operator: "is", value: "Lima" });
    expect(q.sql).toBe("lower((\"contacts\".\"extracted\" ->> $1)) = lower($2)");
    expect(q.params).toEqual(["city", "Lima"]);
  });

  it("ad_id reads the attribution", () => {
    expect(render({ field: "ad_id", type: "text", operator: "has_any" }).sql).toContain("\"ad_attributions\"");
  });
});

describe("compileCondition (date)", () => {
  it("absolute dates use UTC day bounds", () => {
    expect(render({ field: "created_at", type: "date", operator: "after", value: "2026-10-01" }).params).toEqual(["2026-10-02T00:00:00.000Z"]);
    expect(render({ field: "created_at", type: "date", operator: "before", value: "2026-10-01" }).params).toEqual(["2026-10-01T00:00:00.000Z"]);
    const on = render({ field: "created_at", type: "date", operator: "on", value: "2026-10-01" });
    expect(on.params).toEqual(["2026-10-01T00:00:00.000Z", "2026-10-02T00:00:00.000Z"]);
  });
  it("relative dates compute the cutoff from now", () => {
    const lt = render({ field: "last_inbound_at", type: "date", operator: "less_than_ago", value: { amount: 2, unit: "hours" } });
    expect(lt.sql).toContain(" > $1::timestamptz");
    expect(lt.params).toEqual(["2026-10-20T10:00:00.000Z"]);
    const mt = render({ field: "last_order_at", type: "date", operator: "more_than_ago", value: { amount: 30, unit: "minutes" } });
    expect(mt.sql).toContain(" < $1::timestamptz");
    expect(mt.params).toEqual(["2026-10-20T11:30:00.000Z"]);
  });
  it("has_any / is_unknown", () => {
    expect(render({ field: "last_message_at", type: "date", operator: "has_any" }).sql).toMatch(/is not null$/);
    expect(render({ field: "created_at", type: "date", operator: "is_unknown" }).sql).toBe("\"contacts\".\"created_at\" is null");
  });
});

describe("compileCondition (number)", () => {
  it.each([
    ["eq", "="],
    ["neq", "<>"],
    ["gt", ">"],
    ["lt", "<"],
  ])("%s", (operator, op) => {
    const q = render({ field: "total_paid", type: "number", operator, value: 1500 });
    expect(q.sql).toContain(`) ${op} $5::numeric`);
    expect(q.params).toContain("1500");
  });
  it("has_any / is_unknown compare with zero", () => {
    expect(render({ field: "total_paid", type: "number", operator: "has_any" }).sql).toMatch(/\) > 0$/);
    expect(render({ field: "total_paid", type: "number", operator: "is_unknown" }).sql).toMatch(/\) = 0$/);
  });
});

describe("compileCondition (relation)", () => {
  it("tags use array overlap with bound values", () => {
    const q = render({ field: "tag", type: "relation", operator: "is", value: ["vip", "'; drop"] });
    expect(q.sql).toBe("\"contacts\".\"tags\" && array[$1, $2]::text[]");
    expect(q.params).toEqual(["vip", "'; drop"]);
    expect(render({ field: "tag", type: "relation", operator: "is_not", value: ["vip"] }).sql).toMatch(/^not /);
  });
  it("enum relations OR their values", () => {
    const q = render({ field: "marketing_consent", type: "relation", operator: "is", value: ["granted", "none"] });
    expect(q.sql).toContain(" or ");
    expect(q.params).toEqual(["granted", "none"]);
    expect(render({ field: "window_open", type: "relation", operator: "is", value: ["open"] }).params).toEqual(["2026-10-19T12:00:00.000Z"]);
    expect(render({ field: "has_paid_order", type: "relation", operator: "is", value: ["no"] }).sql).toMatch(/^\(\(not exists/);
    expect(render({ field: "source", type: "relation", operator: "is", value: ["import"] }).params).toEqual(["import"]);
  });
  it("segments inline their saved filter and unknown ids match nothing", () => {
    const seg = "11111111-1111-4111-8111-111111111111";
    const segments = new Map<string, ContactFilter>([[seg, { match: "all", conditions: [{ field: "tag", type: "relation", operator: "is", value: ["vip"] }] }]]);
    const q = renderSql(compileCondition({ field: "segment", type: "relation", operator: "is", value: [seg] }, { segments, now }));
    expect(q.params).toEqual(["vip"]);
    const missing = render({ field: "segment", type: "relation", operator: "is", value: [seg] });
    expect(missing.sql).toBe("((false))");
  });
  it("rejects self-referencing segments past the depth limit", () => {
    const seg = "11111111-1111-4111-8111-111111111111";
    const self: ContactFilter = { match: "all", conditions: [{ field: "segment", type: "relation", operator: "is", value: [seg] }] };
    expect(() => compileContactFilter(self, { segments: new Map([[seg, self]]), now })).toThrow(/nested/);
  });
});

describe("compileContactFilter", () => {
  const a: FilterCondition = { field: "name", type: "text", operator: "has_any" };
  const b: FilterCondition = { field: "phone", type: "text", operator: "starts_with", value: "+34" };
  it("joins with AND for all and OR for any", () => {
    expect(renderSql(compileContactFilter({ match: "all", conditions: [a, b] }, ctx)!).sql).toContain(") and (");
    expect(renderSql(compileContactFilter({ match: "any", conditions: [a, b] }, ctx)!).sql).toContain(" or ");
  });
  it("empty filters match everything", () => {
    expect(compileContactFilter({ match: "all", conditions: [] }, ctx)).toBeUndefined();
  });
  it("rejects fields that bypassed validation", () => {
    expect(() => compileCondition({ field: "tenant_id", type: "text", operator: "is", value: "x" }, ctx)).toThrow();
  });
});
