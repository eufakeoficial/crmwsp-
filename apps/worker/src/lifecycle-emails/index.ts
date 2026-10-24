import { PLANS, dueLifecycleEmails, isPlanId, type LifecycleEmail } from "@crmwsp/billing";
import { sql, type Database } from "@crmwsp/db";
import { siteLink, templateMessage, type EmailContext, type MailMessage } from "@crmwsp/mailer";
import type { Logger } from "../processors.js";

/**
 * Billing/lifecycle emails (odd/tasks/wire-emails.md), run from the subscription tick, i.e. always
 * AFTER the settlement transaction committed: a failed email can never roll back a payment.
 * Each email claims its dedupe key in `email_dispatches` (0074) BEFORE sending, so it goes out at
 * most once even with concurrent ticks; a failed send is logged and not retried.
 * Dates are formatted in UTC (no tenant timezone on these system jobs).
 */
export interface LifecycleEmailDeps {
  db: Database;
  send: (message: MailMessage) => Promise<unknown>;
  ctx: EmailContext;
  logger?: Logger;
  now?: () => Date;
}

const silent: Logger = { info: () => {}, warn: () => {}, error: () => {} };
const BILLING_PATH = "/app/settings/billing";
const RECENT_HOURS = 48;

const dateFmt = new Intl.DateTimeFormat("es", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
export const formatDay = (value: string | Date): string =>
  dateFmt.format(typeof value === "string" ? new Date(`${value.slice(0, 10)}T00:00:00Z`) : value);
export const formatAmount = (amount: string | number, currency: string): string =>
  `${Number(amount).toFixed(2).replace(".", ",")} ${currency.toUpperCase()}`;
const planName = (plan: string): string => (isPlanId(plan) ? PLANS[plan].name : plan);

async function claim(db: Database, key: string, template: string, tenantId: string | null): Promise<boolean> {
  const [r] = await db.execute<{ ok: boolean }>(sql`select public.email_dispatch_claim(${key}, ${template}, ${tenantId}::uuid) as ok`);
  return r?.ok === true;
}

async function dispatch(deps: LifecycleEmailDeps, key: string, tenantId: string | null, build: () => MailMessage, template: string): Promise<boolean> {
  if (!(await claim(deps.db, key, template, tenantId))) return false;
  try {
    await deps.send(build());
    return true;
  } catch (err) {
    (deps.logger ?? silent).warn(`lifecycle email ${template} failed (${err instanceof Error ? err.name : "unknown"})`);
    return false;
  }
}

type ChargeRow = {
  charge_id: string; tenant_id: string; tenant_name: string; owner_email: string | null; plan: string; period_days: number;
  price_amount: string; price_currency: string; verified_by: string; provider_payment_id: string | null;
  period_start: string | Date | null; period_end: string | Date | null;
};

export async function runPaidChargeEmails(deps: LifecycleEmailDeps): Promise<number> {
  const rows = await deps.db.execute<ChargeRow>(sql`select * from public.email_recent_paid_charges(${RECENT_HOURS}, 100)`);
  let sent = 0;
  for (const r of rows) {
    if (!r.owner_email || !r.period_start || !r.period_end) continue;
    const to = r.owner_email;
    const coupon = r.verified_by === "coupon" || Number(r.price_amount) === 0;
    const ok = await dispatch(deps, `charge-paid:${r.charge_id}`, r.tenant_id, () =>
      templateMessage(to, "pago-confirmado", {
        tenantName: r.tenant_name,
        plan: planName(r.plan),
        cycle: r.period_days === 365 ? "anual" : r.period_days === 30 ? "mensual" : null,
        periodStart: formatDay(r.period_start as string | Date),
        periodEnd: formatDay(r.period_end as string | Date),
        amount: formatAmount(r.price_amount, r.price_currency),
        reference: r.provider_payment_id ?? r.charge_id.slice(0, 8).toUpperCase(),
        coupon,
        appUrl: siteLink(deps.ctx, BILLING_PATH),
      }, deps.ctx), "pago-confirmado");
    if (ok) sent++;
  }
  return sent;
}

export async function runReferralRewardEmails(deps: LifecycleEmailDeps): Promise<number> {
  const rows = await deps.db.execute<{ reward_id: string; tenant_id: string; owner_email: string | null; owner_name: string | null; referred_name: string; percent: number }>(
    sql`select * from public.email_recent_referral_rewards(${RECENT_HOURS}, 100)`,
  );
  let sent = 0;
  for (const r of rows) {
    if (!r.owner_email) continue;
    const to = r.owner_email;
    const ok = await dispatch(deps, `referral-reward:${r.reward_id}`, r.tenant_id, () =>
      templateMessage(to, "referido-recompensa", {
        name: r.owner_name,
        referredName: r.referred_name,
        reward: `${r.percent}% de descuento`,
        detail: "Se aplicará automáticamente a tu próximo pago mensual. Los descuentos se pueden acumular.",
        appUrl: siteLink(deps.ctx, BILLING_PATH),
      }, deps.ctx), "referido-recompensa");
    if (ok) sent++;
  }
  return sent;
}

type CandidateRow = {
  tenant_id: string; tenant_name: string; owner_email: string | null; owner_name: string | null; plan: string;
  paid_until: string | Date | null; setup_ends_at: string | Date | null; trial_started_at: string | Date | null;
  trial_ends_at: string | Date | null; trial_denied_at: string | Date | null;
};

const asDate = (v: string | Date | null): Date | null => (v === null ? null : v instanceof Date ? v : new Date(v));
const asDay = (v: string | Date | null): string | null => (v === null ? null : v instanceof Date ? v.toISOString().slice(0, 10) : v.slice(0, 10));

/** Builds the message of one due lifecycle email. Exported for tests. */
export function lifecycleMessage(to: string, row: Pick<CandidateRow, "tenant_name" | "plan">, e: LifecycleEmail, ctx: EmailContext): MailMessage {
  const billing = siteLink(ctx, BILLING_PATH);
  switch (e.template) {
    case "prueba-iniciada":
      return templateMessage(to, e.template, { tenantName: row.tenant_name, endsAt: formatDay(e.endsAt), days: e.days, appUrl: siteLink(ctx, "/app") }, ctx);
    case "prueba-por-terminar":
      return templateMessage(to, e.template, { tenantName: row.tenant_name, daysLeft: e.daysLeft, endsAt: formatDay(e.endsAt), plansUrl: billing }, ctx);
    case "prueba-terminada":
      return templateMessage(to, e.template, { tenantName: row.tenant_name, plansUrl: billing }, ctx);
    case "pago-por-vencer": {
      const plan = isPlanId(row.plan) ? PLANS[row.plan] : PLANS.start;
      return templateMessage(to, e.template, {
        tenantName: row.tenant_name, plan: plan.name, dueDate: formatDay(e.dueDate), daysLeft: e.daysLeft,
        amount: `${formatAmount(plan.priceMonthlyUsd, "usd")} al mes`, payUrl: billing,
      }, ctx);
    }
    case "cuenta-solo-lectura":
      return templateMessage(to, e.template, { tenantName: row.tenant_name, since: formatDay(e.since), payUrl: billing }, ctx);
  }
}

export async function runTenantLifecycleEmails(deps: LifecycleEmailDeps): Promise<number> {
  const now = (deps.now ?? (() => new Date()))();
  const rows = await deps.db.execute<CandidateRow>(sql`select * from public.email_lifecycle_candidates(500)`);
  let sent = 0;
  for (const r of rows) {
    if (!r.owner_email) continue;
    const to = r.owner_email;
    const due = dueLifecycleEmails(
      {
        tenantId: r.tenant_id,
        paidUntil: asDay(r.paid_until),
        lifecycle: { setupEndsAt: asDate(r.setup_ends_at), trialStartedAt: asDate(r.trial_started_at), trialEndsAt: asDate(r.trial_ends_at), trialDeniedAt: asDate(r.trial_denied_at) },
      },
      now,
    );
    for (const e of due) {
      if (await dispatch(deps, e.dedupeKey, r.tenant_id, () => lifecycleMessage(to, r, e, deps.ctx), e.template)) sent++;
    }
  }
  return sent;
}

/** One pass over every lifecycle/billing email; a failing group never blocks the others. */
export async function runLifecycleEmails(deps: LifecycleEmailDeps): Promise<number> {
  let sent = 0;
  for (const run of [runPaidChargeEmails, runReferralRewardEmails, runTenantLifecycleEmails]) {
    try {
      sent += await run(deps);
    } catch (err) {
      (deps.logger ?? silent).warn(`lifecycle emails pass failed (${err instanceof Error ? err.name : "unknown"})`);
    }
  }
  return sent;
}
