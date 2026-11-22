import { describe, expect, it } from "vitest";
import { isTemplateSendable, normalizeRejectionReason, planTemplateSync, templateSendIssue, type RemoteTemplate } from "./sync.js";

const remote = (o: Partial<RemoteTemplate> = {}): RemoteTemplate => ({
  externalId: "e1",
  name: "promo",
  language: "es",
  category: "marketing",
  status: "approved",
  body: "Hola",
  ...o,
});
const row = (o: Record<string, unknown> = {}) => ({ id: "a", name: "promo", language: "es", status: "pending", externalId: "e1", ...o });

describe("planTemplateSync", () => {
  it("updates changed rows, imports unknown ones and keeps lagging local rows", () => {
    const plan = planTemplateSync([row(), row({ id: "b", name: "solo_local", externalId: null })], [remote(), remote({ name: "nueva", externalId: "e2" })]);
    expect(plan.updates).toEqual([{ id: "a", status: "approved", externalId: "e1", rejectionReason: null }]);
    expect(plan.inserts.map((i) => i.name)).toEqual(["nueva"]);
  });

  it("matches on name and language", () => {
    const plan = planTemplateSync([row({ language: "en" })], [remote()]);
    expect(plan.updates).toEqual([]);
    expect(plan.inserts).toHaveLength(1);
  });

  it("persists the rejection reason and detects a reason that appears later", () => {
    const rej = remote({ status: "rejected", reason: "  INVALID_FORMAT " });
    expect(planTemplateSync([row({ status: "rejected" })], [rej]).updates).toEqual([
      { id: "a", status: "rejected", externalId: "e1", rejectionReason: "INVALID_FORMAT" },
    ]);
    expect(planTemplateSync([row({ status: "rejected", rejectionReason: "INVALID_FORMAT" })], [rej]).updates).toEqual([]);
    expect(planTemplateSync([row({ status: "rejected" })], [rej]).rejections).toEqual([{ name: "promo", language: "es", reason: "INVALID_FORMAT" }]);
  });

  it("clears a stale reason once the template is approved again", () => {
    const plan = planTemplateSync([row({ status: "rejected", rejectionReason: "X" })], [remote({ reason: "ignored" })]);
    expect(plan.updates).toEqual([{ id: "a", status: "approved", externalId: "e1", rejectionReason: null }]);
  });

  it.each(["paused", "disabled", "pending"] as const)("maps %s without a reason", (status) => {
    const plan = planTemplateSync([row({ status: "approved" })], [remote({ status })]);
    expect(plan.updates).toEqual([{ id: "a", status, externalId: "e1", rejectionReason: null }]);
  });
});

describe("normalizeRejectionReason", () => {
  it("only applies to rejected templates and caps the length", () => {
    expect(normalizeRejectionReason("approved", "x")).toBeNull();
    expect(normalizeRejectionReason("rejected", "   ")).toBeNull();
    expect(normalizeRejectionReason("rejected", undefined)).toBeNull();
    expect(normalizeRejectionReason("rejected", "x".repeat(500))).toHaveLength(200);
  });
});

describe("templateSendIssue", () => {
  it.each(["pending", "rejected", "paused", "disabled"])("blocks a %s template", (status) => {
    expect(templateSendIssue({ status })).toBe("not_approved");
    expect(isTemplateSendable(status)).toBe(false);
  });
  it("allows approved and optionally requires the BSP id", () => {
    expect(templateSendIssue({ status: "approved" })).toBeNull();
    expect(templateSendIssue({ status: "approved", externalId: null }, { requireExternalId: true })).toBe("no_external_id");
    expect(templateSendIssue({ status: "approved", externalId: "e" }, { requireExternalId: true })).toBeNull();
  });
});
