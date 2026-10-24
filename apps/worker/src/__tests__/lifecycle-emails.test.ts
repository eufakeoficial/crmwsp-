import type { Database } from "@crmwsp/db";
import type { MailMessage } from "@crmwsp/mailer";
import { describe, expect, it } from "vitest";
import { formatAmount, formatDay, lifecycleMessage, runPaidChargeEmails } from "../lifecycle-emails/index.js";

const ctx = { siteUrl: "https://www.vendemas.chat", assetsUrl: "https://www.vendemas.chat/brand" };
const clean = (m: MailMessage) => {
  expect(m.text + (m.html ?? "")).not.toMatch(/undefined|NaN|\[object/);
  for (const [, href] of (m.html ?? "").matchAll(/href="([^"]+)"/g)) expect(href).toMatch(/^https:\/\//);
};

/** Fake db: candidate rows for the select, an in-memory email_dispatches for the claims. */
function fakeDb(rows: unknown[]) {
  const claimed = new Set<string>();
  const db = {
    execute: async (q: { queryChunks: unknown[] }) => {
      const text = JSON.stringify(q.queryChunks);
      if (text.includes("email_dispatch_claim")) {
        const key = q.queryChunks.find((c): c is string => typeof c === "string" && c.startsWith("charge-paid:")) ?? "";
        const ok = !claimed.has(key);
        claimed.add(key);
        return [{ ok }];
      }
      return rows;
    },
  };
  return db as unknown as Database;
}

const charge = (over: Record<string, unknown> = {}) => ({
  charge_id: "11111111-1111-4111-8111-111111111111", tenant_id: "t1", tenant_name: "Clínica Aurora", owner_email: "o@x.test",
  plan: "pro", period_days: 30, price_amount: "89.00", price_currency: "usd", verified_by: "webhook",
  provider_payment_id: "5077125051", period_start: "2026-11-01", period_end: "2026-12-01", ...over,
});

describe("formatting", () => {
  it("formats days and amounts in Spanish", () => {
    expect(formatDay("2026-11-01")).toBe("1 de noviembre de 2026");
    expect(formatAmount("890", "usd")).toBe("890,00 USD");
  });
});

describe("runPaidChargeEmails", () => {
  it("sends pago-confirmado once per charge (dedupe), never twice", async () => {
    const sent: MailMessage[] = [];
    const db = fakeDb([charge()]);
    const deps = { db, ctx, send: async (m: MailMessage) => void sent.push(m) };
    expect(await runPaidChargeEmails(deps)).toBe(1);
    expect(await runPaidChargeEmails(deps)).toBe(0);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.subject).toBe("Pago confirmado: plan Pro mensual");
    expect(sent[0]?.text).toContain("89,00 USD");
    clean(sent[0] as MailMessage);
  });

  it("annual and coupon grants use their own phrasing", async () => {
    const sent: MailMessage[] = [];
    const db = fakeDb([
      charge({ period_days: 365, price_amount: "890.00" }),
      charge({ charge_id: "22222222-2222-4222-8222-222222222222", verified_by: "coupon", price_amount: "0", period_days: 14, provider_payment_id: null }),
    ]);
    await runPaidChargeEmails({ db, ctx, send: async (m) => void sent.push(m) });
    expect(sent.map((m) => m.subject)).toEqual(["Pago confirmado: plan Pro anual", "Cupón aplicado: plan Pro"]);
    expect(sent[1]?.text).toContain("Sin costo (cupón)");
    sent.forEach(clean);
  });

  it("a failed send is logged and never throws (payment already committed)", async () => {
    const warns: string[] = [];
    const db = fakeDb([charge()]);
    const n = await runPaidChargeEmails({
      db, ctx, send: async () => { throw new Error("smtp down"); },
      logger: { info: () => {}, warn: (m) => void warns.push(m), error: () => {} },
    });
    expect(n).toBe(0);
    expect(warns[0]).toContain("pago-confirmado failed");
  });
});

describe("lifecycleMessage", () => {
  const row = { tenant_name: "Clínica Aurora", plan: "start" };
  it.each([
    [{ template: "prueba-iniciada", dedupeKey: "k", endsAt: new Date("2026-11-08T10:00:00Z"), days: 7 }, "Tu prueba gratis de Vende+ WSP ya empezó"],
    [{ template: "prueba-por-terminar", dedupeKey: "k", endsAt: new Date("2026-11-08T10:00:00Z"), daysLeft: 2 }, "Tu prueba gratis termina en 2 días"],
    [{ template: "prueba-terminada", dedupeKey: "k" }, "Tu prueba gratis terminó"],
    [{ template: "pago-por-vencer", dedupeKey: "k", dueDate: "2026-11-30", daysLeft: 3 }, "Tu plan Start vence en 3 días"],
    [{ template: "cuenta-solo-lectura", dedupeKey: "k", since: new Date("2026-12-04T00:00:00Z") }, "Clínica Aurora está en modo solo lectura"],
  ] as const)("%o", (e, subject) => {
    const m = lifecycleMessage("o@x.test", row, e, ctx);
    expect(m.subject).toBe(subject);
    clean(m);
  });

  it("renewal uses the real Start price", () => {
    const m = lifecycleMessage("o@x.test", row, { template: "pago-por-vencer", dedupeKey: "k", dueDate: "2026-11-30", daysLeft: 3 }, ctx);
    expect(m.text).toContain("49,00 USD al mes");
  });
});
