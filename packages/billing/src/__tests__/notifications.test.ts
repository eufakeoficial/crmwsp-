import { describe, expect, it } from "vitest";
import { dueLifecycleEmails, type LifecycleEmailSnapshot } from "../notifications.js";

const DAY = 86_400_000;
const at = (iso: string) => new Date(iso);
const templates = (s: LifecycleEmailSnapshot, now: Date) => dueLifecycleEmails(s, now).map((e) => e.template);
const paid = (paidUntil: string): LifecycleEmailSnapshot => ({ tenantId: "t1", paidUntil, lifecycle: null });
const trial = (startedIso: string): LifecycleEmailSnapshot => {
  const started = at(startedIso);
  return {
    tenantId: "t1",
    paidUntil: null,
    lifecycle: { setupEndsAt: new Date(started.getTime() + DAY), trialStartedAt: started, trialEndsAt: new Date(started.getTime() + 7 * DAY) },
  };
};

describe("dueLifecycleEmails: paid tenants", () => {
  it("announces the renewal 3 days before the last paid day, with a per-period key", () => {
    expect(templates(paid("2026-11-30"), at("2026-11-26T12:00:00Z"))).toEqual([]);
    const [e] = dueLifecycleEmails(paid("2026-11-30"), at("2026-11-27T12:00:00Z"));
    expect(e).toMatchObject({ template: "pago-por-vencer", dedupeKey: "renewal-due:t1:2026-11-30", daysLeft: 3 });
    expect(dueLifecycleEmails(paid("2026-12-30"), at("2026-12-27T12:00:00Z"))[0]?.dedupeKey).toBe("renewal-due:t1:2026-12-30");
  });

  it("on the last paid day it says 0 days (vence hoy), never 1", () => {
    expect(dueLifecycleEmails(paid("2026-11-30"), at("2026-11-30T09:00:00Z"))[0]).toMatchObject({ template: "pago-por-vencer", daysLeft: 0 });
  });

  it("marks read-only once, on the first day after grace, and never for old restrictions", () => {
    expect(templates(paid("2026-11-30"), at("2026-12-03T23:00:00Z"))).toEqual([]);
    expect(dueLifecycleEmails(paid("2026-11-30"), at("2026-12-04T01:00:00Z"))[0]).toMatchObject({
      template: "cuenta-solo-lectura",
      dedupeKey: "restricted:t1:2026-11-30",
    });
    expect(templates(paid("2026-11-30"), at("2026-12-10T00:00:00Z"))).toEqual([]);
  });
});

describe("dueLifecycleEmails: trial", () => {
  it("trial started within the window", () => {
    expect(dueLifecycleEmails(trial("2026-11-01T10:00:00Z"), at("2026-11-01T10:05:00Z"))[0]).toMatchObject({
      template: "prueba-iniciada",
      dedupeKey: "trial-started:t1",
      days: 7,
    });
    expect(templates(trial("2026-11-01T10:00:00Z"), at("2026-11-05T10:00:00Z"))).toEqual([]);
  });

  it("trial ending 2 days before the end", () => {
    const s = trial("2026-11-01T10:00:00Z");
    expect(templates(s, at("2026-11-06T09:00:00Z"))).toEqual([]);
    expect(dueLifecycleEmails(s, at("2026-11-06T11:00:00Z"))[0]).toMatchObject({ template: "prueba-por-terminar", daysLeft: 2 });
  });

  it("trial ended once grace is over, within the window only", () => {
    const s = trial("2026-11-01T10:00:00Z");
    expect(templates(s, at("2026-11-10T10:00:00Z"))).toEqual([]);
    expect(templates(s, at("2026-11-11T10:01:00Z"))).toEqual(["prueba-terminada"]);
    expect(templates(s, at("2026-11-20T10:00:00Z"))).toEqual([]);
  });

  it("grandfathered or never-started tenants get nothing", () => {
    expect(templates({ tenantId: "t1", paidUntil: null, lifecycle: null }, at("2026-11-01T00:00:00Z"))).toEqual([]);
    expect(
      templates({ tenantId: "t1", paidUntil: null, lifecycle: { setupEndsAt: at("2026-11-07T00:00:00Z"), trialStartedAt: null, trialEndsAt: null } }, at("2026-11-02T00:00:00Z")),
    ).toEqual([]);
  });
});
