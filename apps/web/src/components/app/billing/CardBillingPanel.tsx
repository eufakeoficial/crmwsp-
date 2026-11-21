"use client";

import { useEffect, useState } from "react";
import type { BillingPeriodDto, CardBilling } from "@crmwsp/contracts";
import { Alert, Button, Card } from "@/components/ui";
import { CARD_STATUS_LABEL, cardBillingApi, cardPeriodsFor, cardReturnNotice, isStripeRedirect } from "@/lib/card-billing";
import { errorMessage } from "@/lib/messages";

const PLANS = [
  { id: "start", name: "Start", monthly: 49, annual: 490 },
  { id: "pro", name: "Pro", monthly: 89, annual: 890 },
] as const;

/**
 * Card payment with automatic renewal (Stripe Billing, ADR 0022), next to the crypto option.
 * Renders nothing when the deployment has no Stripe configured. It never decides that a payment is
 * complete: Stripe sends the browser back and the verified webhook grants the period.
 */
export function CardBillingPanel() {
  const [card, setCard] = useState<CardBilling>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [period, setPeriod] = useState<BillingPeriodDto>("monthly");
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    setNotice(cardReturnNotice(new URLSearchParams(window.location.search).get("card")));
    cardBillingApi.status().then(setCard, () => setCard({ enabled: false, available: [], subscription: null }));
  }, []);

  if (!card?.enabled) return null;

  const go = (promise: Promise<{ url: string }>) => {
    setBusy(true);
    setError(undefined);
    promise.then(
      ({ url }) => {
        if (!isStripeRedirect(url)) {
          setError("No se pudo abrir la página de pago. Inténtalo de nuevo.");
          setBusy(false);
          return;
        }
        window.location.assign(url);
      },
      (err: unknown) => {
        setError(errorMessage(err));
        setBusy(false);
      },
    );
  };

  const sub = card.subscription;
  const hasPeriod = card.available.some((a) => a.period === period);
  return (
    <Card>
      <p className="m-0 text-sm font-semibold">Pagar con tarjeta (renovación automática)</p>
      {notice ? <p className="m-0 mt-1 text-[13px] text-ink-3">{notice}</p> : null}
      {error ? <Alert>{error}</Alert> : null}
      {sub ? (
        <p className="m-0 mt-2 text-sm text-ink-3">
          {CARD_STATUS_LABEL[sub.status]}
          {sub.plan ? ` · Plan ${sub.plan === "pro" ? "Pro" : "Start"} ${sub.period === "annual" ? "anual" : "mensual"}` : ""}
          {sub.currentPeriodEnd ? ` · próximo cobro ${new Date(sub.currentPeriodEnd).toLocaleDateString("es")}` : ""}
          {sub.cancelAtPeriodEnd ? " · se cancela al final del período" : ""}
        </p>
      ) : (
        <p className="m-0 mt-2 text-sm text-ink-3">Se cobra cada período a tu tarjeta y tu plan se renueva solo. Puedes cancelar cuando quieras desde el portal.</p>
      )}
      <div className="mt-3 flex flex-wrap gap-2" role="radiogroup" aria-label="Período de pago con tarjeta">
        {(["monthly", "annual"] as const)
          .filter((p) => card.available.some((a) => a.period === p))
          .map((p) => (
            <Button key={p} size="sm" role="radio" aria-checked={period === p} variant={period === p ? "outline" : "ghost"} onClick={() => setPeriod(p)}>
              {p === "monthly" ? "Mensual" : "Anual (2 meses gratis)"}
            </Button>
          ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {PLANS.filter((p) => cardPeriodsFor(card.available, p.id).includes(period)).map((p) => (
          <Button key={p.id} disabled={busy || !hasPeriod} variant={p.id === "pro" ? "accent" : "primary"} onClick={() => go(cardBillingApi.checkout(p.id, period))}>
            Suscribirme a {p.name} · US${period === "annual" ? p.annual : p.monthly}
          </Button>
        ))}
        {sub ? (
          <Button disabled={busy} variant="outline" onClick={() => go(cardBillingApi.portal())}>
            Gestionar tarjeta y facturas
          </Button>
        ) : null}
      </div>
      <p className="m-0 mt-2 text-[13px] text-ink-3">El pago lo procesa Stripe; no guardamos los datos de tu tarjeta. El plan se activa cuando Stripe confirma el cobro.</p>
    </Card>
  );
}
