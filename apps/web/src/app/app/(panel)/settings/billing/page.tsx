"use client";

import { useCallback, useEffect, useState } from "react";
import {
  billingPlanResponseSchema,
  subscriptionChargeListSchema,
  subscriptionChargeSchema,
  subscriptionQuoteSchema,
  type BillingPeriodDto,
  type CouponIneligibilityDto,
  type SubscriptionQuote,
  type BillingPlanResponse,
  type SubscriptionChargeDto,
} from "@crmwsp/contracts";
import { SettingsFrame } from "@/components/ai/AccessGate";
import { canManageAi } from "@/components/app/roles";
import { useSession } from "@/components/app/SessionProvider";
import { Alert, Button, Card, Spinner } from "@/components/ui";
import { request } from "@/lib/api";
import { errorMessage } from "@/lib/messages";

// Subscription payment in crypto through NOWPayments (ADR 0013). The page never decides that a
// payment is complete: it only shows what the server reports after the IPN / reconciliation.

const api = {
  plan: () => request("/billing/plan", { schema: billingPlanResponseSchema }),
  charges: () => request("/billing/subscription/charges", { schema: subscriptionChargeListSchema }),
  charge: (id: string) => request(`/billing/subscription/charges/${id}`, { schema: subscriptionChargeSchema }),
  create: (plan: "start" | "pro", period: BillingPeriodDto, couponCode?: string) =>
    request("/billing/subscription/charges", { method: "POST", body: { plan, period, couponCode }, schema: subscriptionChargeSchema }),
  quote: (plan: "start" | "pro", period: BillingPeriodDto, couponCode?: string) =>
    request("/billing/subscription/quote", { method: "POST", body: { plan, period, couponCode }, schema: subscriptionQuoteSchema }),
};

const COUPON_ERROR: Record<CouponIneligibilityDto, string> = {
  not_found: "Ese cupón no existe.",
  inactive: "Ese cupón no está activo.",
  not_started: "Ese cupón todavía no está vigente.",
  expired: "Ese cupón ya venció.",
  plan_not_applicable: "El cupón no aplica a este plan.",
  period_not_applicable: "El cupón no aplica a este período de pago.",
  exhausted: "El cupón ya alcanzó su límite de usos.",
  tenant_limit: "Ya usaste este cupón (o tienes un pago pendiente con él).",
};

function priceLabel(q: SubscriptionQuote | undefined, fallback: number): string {
  if (!q) return `US$${fallback}`;
  if (q.freeDays > 0) return `${q.freeDays} días gratis`;
  if (q.free) return "Gratis";
  return q.discount !== "0.00" ? `US$${q.finalPrice} (antes US$${q.listPrice})` : `US$${q.finalPrice}`;
}

const POLL_MS = 10_000;

const PERIOD_DAYS: Record<BillingPeriodDto, number> = { monthly: 30, annual: 365 };

const STATUS_LABEL: Record<SubscriptionChargeDto["status"], string> = {
  pending: "Esperando el pago",
  paid: "Pagado",
  failed: "Fallido",
  expired: "Expirado",
  refunded: "Reembolsado",
};

const ACCESS_LABEL: Record<BillingPlanResponse["subscription"]["access"], string> = {
  unbilled: "Sin suscripción registrada",
  active: "Suscripción al día",
  grace: "Período vencido: en días de gracia",
  restricted: "Suscripción vencida: acceso de solo lectura (sin IA ni envíos)",
  setup: "Configuración: conecta tu WhatsApp para empezar tu prueba",
  trial: "Prueba gratuita en curso",
  payment_required: "Este número ya usó su prueba gratuita. Activa un plan para continuar.",
};

function PendingCharge({ charge }: { charge: SubscriptionChargeDto }) {
  const [copied, setCopied] = useState(false);
  const copy = (text: string) => {
    void navigator.clipboard?.writeText(text).then(() => setCopied(true), () => undefined);
  };
  return (
    <Card>
      <p className="m-0 text-sm text-ink-3">Pago en curso · {STATUS_LABEL[charge.status]}{charge.providerStatus ? ` (${charge.providerStatus})` : ""}</p>
      <p className="m-0 mt-2 text-[22px] font-extrabold">
        {charge.payAmount ?? "—"} {charge.payCurrency.toUpperCase()}
      </p>
      <p className="m-0 text-sm text-ink-3">
        Equivale a US${charge.priceAmount} por {PERIOD_DAYS[charge.period]} días del plan {charge.plan === "pro" ? "Pro" : "Start"}. Envía el monto exacto o más; un pago menor queda pendiente.
      </p>
      {charge.payAddress ? (
        <div className="mt-3 flex flex-col gap-2">
          <span className="text-sm font-semibold">Dirección de depósito</span>
          <code className="break-all rounded bg-paper p-2 text-[13px]" data-qr={charge.qrData ?? undefined}>
            {charge.payAddress}
          </code>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => copy(charge.payAddress ?? "")}>
              {copied ? "Copiada" : "Copiar dirección"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => copy(charge.payAmount ?? "")}>
              Copiar monto
            </Button>
          </div>
        </div>
      ) : null}
      <p className="m-0 mt-3 text-[13px] text-ink-3">Esta página se actualiza sola. La confirmación en la red puede tardar unos minutos.</p>
    </Card>
  );
}

function Body() {
  const [plan, setPlan] = useState<BillingPlanResponse>();
  const [charges, setCharges] = useState<SubscriptionChargeDto[]>([]);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [period, setPeriod] = useState<BillingPeriodDto>("monthly");
  const [couponInput, setCouponInput] = useState("");
  const [coupon, setCoupon] = useState<string>();
  const [quotes, setQuotes] = useState<Partial<Record<"start" | "pro", SubscriptionQuote>>>({});

  // Server-side price preview (ADR 0017): the client never computes the price it pays.
  useEffect(() => {
    let alive = true;
    Promise.all([api.quote("start", period, coupon), api.quote("pro", period, coupon)]).then(
      ([start, pro]) => alive && setQuotes({ start, pro }),
      () => alive && setQuotes({}),
    );
    return () => {
      alive = false;
    };
  }, [period, coupon, charges.length]);
  const couponError = quotes.start?.couponError && quotes.pro?.couponError ? quotes.start.couponError : null;

  const load = useCallback(() => {
    Promise.all([api.plan(), api.charges()]).then(
      ([p, c]) => {
        setPlan(p);
        setCharges(c.items);
      },
      (err: unknown) => setError(errorMessage(err)),
    );
  }, []);
  useEffect(load, [load]);

  const pending = charges.find((c) => c.status === "pending" && c.payAddress);
  const pendingId = pending?.id;
  useEffect(() => {
    if (!pendingId) return;
    const t = setInterval(() => {
      api.charge(pendingId).then(
        (c) => {
          setCharges((cs) => cs.map((x) => (x.id === c.id ? c : x)));
          if (c.status !== "pending") load();
        },
        () => undefined,
      );
    }, POLL_MS);
    return () => clearInterval(t);
  }, [pendingId, load]);

  const pay = (p: "start" | "pro") => {
    setBusy(true);
    setError(undefined);
    api.create(p, period, quotes[p]?.couponError ? undefined : coupon).then(
      (c) => {
        setCharges((cs) => [c, ...cs.filter((x) => x.id !== c.id)]);
        if (c.status === "paid") {
          setCoupon(undefined);
          setCouponInput("");
          load();
        }
      },
      (err: unknown) => setError(errorMessage(err)),
    ).finally(() => setBusy(false));
  };

  if (!plan && !error) return <Spinner />;
  return (
    <div className="flex flex-col gap-4">
      {error ? <Alert>{error}</Alert> : null}
      {plan ? (
        <Card>
          <p className="m-0 text-sm text-ink-3">{ACCESS_LABEL[plan.subscription.access]}</p>
          <p className="m-0 text-[28px] font-extrabold">{plan.plan.name}</p>
          <p className="m-0 text-ink-3">
            {plan.subscription.paidUntil ? `Pagado hasta el ${plan.subscription.paidUntil}` : "Sin períodos pagados"} · {plan.subscription.graceDays} días de gracia
          </p>
          {plan.billingProvider === "nowpayments" ? (
            <>
              <div className="mt-3 flex flex-wrap gap-2" role="radiogroup" aria-label="Período de pago">
                {(["monthly", "annual"] as const).map((p) => (
                  <Button key={p} size="sm" role="radio" aria-checked={period === p} variant={period === p ? "outline" : "ghost"} onClick={() => setPeriod(p)}>
                    {p === "monthly" ? "Mensual (30 días)" : "Anual (365 días, 2 meses gratis)"}
                  </Button>
                ))}
              </div>
              <form
                className="mt-3 flex flex-wrap items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  setCoupon(couponInput.trim() || undefined);
                }}
              >
                <input
                  aria-label="Cupón de descuento"
                  placeholder="Cupón de descuento"
                  value={couponInput}
                  maxLength={32}
                  onChange={(e) => setCouponInput(e.target.value.toUpperCase())}
                  className="h-9 rounded-xl border-[1.5px] border-ink bg-white px-2.5 text-[13px] uppercase"
                />
                <Button size="sm" variant="outline" type="submit">Aplicar</Button>
                {coupon ? (
                  <Button size="sm" variant="ghost" type="button" onClick={() => { setCoupon(undefined); setCouponInput(""); }}>
                    Quitar
                  </Button>
                ) : null}
                {coupon && couponError ? <span className="text-[13px] text-red-700">{COUPON_ERROR[couponError]}</span> : null}
                {coupon && !couponError && quotes.start?.coupon ? <span className="text-[13px] text-ink-3">Cupón {quotes.start.coupon.code} aplicado.</span> : null}
              </form>
              {!coupon && (quotes.start?.referralCredits ?? 0) > 0 ? (
                <p className="m-0 mt-2 text-[13px] text-ink-3">
                  Tienes {quotes.start?.referralCredits} recompensa(s) por referidos: se aplican al próximo pago mensual.
                </p>
              ) : null}
              <div className="mt-3 flex flex-wrap gap-2">
                <Button disabled={busy} onClick={() => pay("start")}>
                  {quotes.start?.free ? "Activar" : "Pagar"} {quotes.start?.freeDays ? "" : `${PERIOD_DAYS[period]} días `}Start · {priceLabel(quotes.start, period === "annual" ? 490 : 49)}
                </Button>
                <Button disabled={busy} variant="accent" onClick={() => pay("pro")}>
                  {quotes.pro?.free ? "Activar" : "Pagar"} {quotes.pro?.freeDays ? "" : `${PERIOD_DAYS[period]} días `}Pro · {priceLabel(quotes.pro, period === "annual" ? 890 : 89)}
                </Button>
              </div>
            </>
          ) : (
            <p className="m-0 mt-2 text-sm text-ink-3">El pago en línea de la suscripción no está habilitado. Contacta con soporte.</p>
          )}
          <p className="m-0 mt-2 text-[13px] text-ink-3">Cada pago suma 30 días (o 365 si es anual) desde el final del período actual. No hay cobros automáticos: para renovar, paga otra vez.</p>
        </Card>
      ) : null}
      {pending ? <PendingCharge charge={pending} /> : null}
      {charges.length > 0 ? (
        <Card>
          <p className="m-0 mb-2 text-sm font-semibold">Historial</p>
          <ul className="m-0 flex list-none flex-col gap-2 p-0 text-sm">
            {charges.map((c) => (
              <li key={c.id} className="flex justify-between gap-3">
                <span>
                  {new Date(c.createdAt).toLocaleDateString("es")} · {c.plan === "pro" ? "Pro" : "Start"} · {c.verifiedBy === "coupon" ? `${c.periodDays} días sin cargo` : c.period === "annual" ? "anual" : "mensual"} · US${c.priceAmount}
                  {c.couponCode ? ` · cupón ${c.couponCode}` : c.referralCredits > 0 ? " · referidos" : ""}
                </span>
                <span className="text-ink-3">
                  {STATUS_LABEL[c.status]}
                  {c.periodEnd ? ` · hasta ${c.periodEnd}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}

export default function Page() {
  const { tenant } = useSession();
  return (
    <SettingsFrame title="Suscripción" subtitle="Paga tu plan con criptomonedas (USDT).">
      {() => (canManageAi(tenant?.role) ? <Body /> : <Alert>Solo propietarios y administradores gestionan la suscripción.</Alert>)}
    </SettingsFrame>
  );
}
