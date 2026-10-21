import { describe, expect, it } from "vitest";
import {
  MissingTemplateVariableError,
  canTransitionBroadcast,
  countTemplatePlaceholders,
  isOptOutMessage,
  resolveAudience,
  resolveBroadcastParams,
  type AudienceContact,
} from "./index.js";

const c = (id: string, over: Partial<AudienceContact> = {}): AudienceContact => ({
  id,
  phoneE164: `+3460000000${id}`,
  name: `N${id}`,
  tags: [],
  extracted: {},
  marketingConsent: "granted",
  ...over,
});

describe("broadcast transitions", () => {
  it("follows draft -> scheduled -> sending -> completed and allows cancel while open", () => {
    expect(canTransitionBroadcast("draft", "scheduled")).toBe(true);
    expect(canTransitionBroadcast("scheduled", "sending")).toBe(true);
    expect(canTransitionBroadcast("sending", "completed")).toBe(true);
    expect(canTransitionBroadcast("sending", "cancelled")).toBe(true);
    expect(canTransitionBroadcast("completed", "cancelled")).toBe(false);
    expect(canTransitionBroadcast("draft", "sending")).toBe(false);
    expect(canTransitionBroadcast("cancelled", "scheduled")).toBe(false);
  });
});

describe("resolveAudience", () => {
  it("excludes contacts without opt-in or with opt-out", () => {
    const r = resolveAudience([c("1"), c("2", { marketingConsent: null }), c("3", { marketingConsent: "revoked" })], { tags: [], excludeTags: [] });
    expect(r.recipients.map((x) => x.id)).toEqual(["1"]);
    expect(r.excludedNoConsent).toBe(2);
  });

  it("filters by all required tags and any excluded tag", () => {
    const list = [c("1", { tags: ["vip", "es"] }), c("2", { tags: ["vip"] }), c("3", { tags: ["vip", "es", "churn"] })];
    const r = resolveAudience(list, { tags: ["vip", "es"], excludeTags: ["churn"] });
    expect(r.recipients.map((x) => x.id)).toEqual(["1"]);
  });

  it("dedupes by phone digits keeping the first", () => {
    const r = resolveAudience([c("1", { phoneE164: "+34 600 111" }), c("2", { phoneE164: "+34600111" })], { tags: [], excludeTags: [] });
    expect(r.recipients.map((x) => x.id)).toEqual(["1"]);
    expect(r.duplicates).toBe(1);
  });
});

describe("resolveBroadcastParams", () => {
  it("maps contact fields, static values and fallbacks", () => {
    const params = resolveBroadcastParams(
      [
        { source: "contact_name" },
        { source: "contact_field", key: "city", fallback: "tu ciudad" },
        { source: "contact_field", key: "points" },
        { source: "static", value: "PROMO10" },
        { source: "contact_phone" },
      ],
      { name: "Ana", phoneE164: "+34600", extracted: { points: 12 } },
    );
    expect(params).toEqual(["Ana", "tu ciudad", "12", "PROMO10", "+34600"]);
  });

  it("throws when a value is missing", () => {
    expect(() => resolveBroadcastParams([{ source: "contact_name" }], { name: null, phoneE164: "+1", extracted: {} })).toThrow(
      MissingTemplateVariableError,
    );
  });
});

describe("template placeholders and opt-out keywords", () => {
  it("counts placeholders", () => {
    expect(countTemplatePlaceholders("Hola {{1}}, usa {{ 2 }} antes del {{2}}")).toBe(2);
    expect(countTemplatePlaceholders("Sin variables")).toBe(0);
  });

  it("detects BAJA / STOP as whole replies only", () => {
    expect(isOptOutMessage("baja")).toBe(true);
    expect(isOptOutMessage(" STOP! ")).toBe(true);
    expect(isOptOutMessage("No más")).toBe(true);
    expect(isOptOutMessage("quiero bajar el precio")).toBe(false);
    expect(isOptOutMessage("stop sending me the old price, I want the new one")).toBe(false);
    expect(isOptOutMessage(null)).toBe(false);
  });
});
