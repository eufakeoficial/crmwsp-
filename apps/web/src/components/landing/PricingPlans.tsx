"use client";

import { ArrowRight, Check } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { buttonClasses } from "@/components/ui";
import { PRICING_ANNUAL_BADGE, PRICING_PERIOD_DAYS, PRICING_PLANS, PRICING_PROMISES, PRICING_TRIAL_NOTE, type PricingPlan } from "./pricing-content";
import { DISPLAY } from "./styles";

type Billing = "monthly" | "annual";

/** Dot as thousands separator (30.000), independent of the runtime locale data. */
const fmt = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ".");

function limitsOf(plan: PricingPlan): { label: string; value: string }[] {
  return [
    { label: "Usuarios", value: String(plan.seats) },
    { label: "Números de WhatsApp", value: String(plan.whatsappNumbers) },
    { label: "Contactos", value: fmt(plan.contacts) },
    { label: "Envíos masivos al mes", value: plan.broadcasts === null ? "No incluido" : fmt(plan.broadcasts) },
  ];
}

export function PricingPlans() {
  const [billing, setBilling] = useState<Billing>("monthly");
  const annual = billing === "annual";
  return (
    <div>
      <div role="group" aria-label="Periodo de facturación" className="mb-8 inline-flex items-center gap-1 rounded-full border border-line bg-white p-1">
        {(["monthly", "annual"] as const).map((b) => (
          <button
            key={b}
            type="button"
            aria-pressed={billing === b}
            onClick={() => setBilling(b)}
            className={`inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full px-5 text-sm font-bold transition ${billing === b ? "bg-ink text-white" : "text-ink-3 hover:text-ink"}`}
          >
            {b === "monthly" ? "Mensual" : "Anual"}
            {b === "annual" ? <span className={`rounded-full px-2 py-0.5 text-xs ${billing === b ? "bg-lime text-ink" : "bg-lime-soft text-ink"}`}>{PRICING_ANNUAL_BADGE}</span> : null}
          </button>
        ))}
      </div>
      <div className="grid gap-5 md:grid-cols-2">
        {PRICING_PLANS.map((plan) => {
          const price = annual ? plan.priceAnnualUsd : plan.priceMonthlyUsd;
          return (
            <article key={plan.id} aria-labelledby={`plan-${plan.id}`} className={`flex flex-col gap-5 rounded-[28px] border bg-white p-[clamp(20px,3vw,36px)] ${plan.highlight ? "border-2 border-ink" : "border-line"}`}>
              <header className="flex flex-col gap-2">
                <h3 id={`plan-${plan.id}`} className={`${DISPLAY} m-0 text-2xl font-bold`}>{plan.name}</h3>
                <p className="m-0 text-ink-3">{plan.tagline}</p>
              </header>
              <div>
                <p className="m-0 flex flex-wrap items-baseline gap-x-2">
                  <span className={`${DISPLAY} text-5xl font-bold tracking-[-0.02em]`}>USD {price}</span>
                  <span className="text-ink-3">/ {annual ? "365 días" : `${PRICING_PERIOD_DAYS} días`}</span>
                </p>
                {annual ? <p className="mt-1 mb-0 text-sm font-semibold">{PRICING_ANNUAL_BADGE}: pagas 10 meses de USD {plan.priceMonthlyUsd}</p> : null}
                <p className="mt-3 mb-0 text-sm text-ink-3">{PRICING_PROMISES}</p>
              </div>
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {limitsOf(plan).map(({ label, value }) => (
                  <li key={label} className="flex items-start gap-2">
                    <span aria-hidden className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-lime text-ink"><Check className="size-3.5" /></span>
                    <span>{label}: <strong>{value}</strong></span>
                  </li>
                ))}
              </ul>
              <Link href="/signup" className={buttonClasses(plan.highlight ? "primary" : "outline", "mt-auto", "lg")}>
                Empezar con {plan.name}
                <ArrowRight aria-hidden className="size-5" />
              </Link>
            </article>
          );
        })}
      </div>
      <p className="mt-6 mb-0 font-semibold">{PRICING_TRIAL_NOTE}</p>
    </div>
  );
}
