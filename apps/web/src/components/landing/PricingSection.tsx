"use client";

import { Check } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { buttonClasses } from "@/components/ui";

type Billing = "monthly" | "annual";

const PLANS = [
  {
    name: "Start",
    monthly: 49,
    tagline: "Para empezar a vender por WhatsApp con orden.",
    features: [
      "2 números de WhatsApp",
      "5 usuarios",
      "10.000 contactos",
      "IA con citas a tu catálogo (sin precios inventados)",
      "Pedidos y presupuestos",
      "CRM kanban y seguimientos",
      "Dashboard",
    ],
    highlight: false,
  },
  {
    name: "Pro",
    monthly: 89,
    tagline: "Para equipos que escalan campañas e integraciones.",
    features: [
      "4 números de WhatsApp",
      "15 usuarios",
      "30.000 contactos",
      "Todo lo de Start",
      "Difusiones (broadcasts)",
      "Atribución de ROAS de Meta Ads",
      "API pública y webhooks",
      "Integraciones Stripe y Shopify",
    ],
    highlight: true,
  },
] as const;

function format(value: number): string {
  return `US$${value.toLocaleString("es")}`;
}

export function PricingSection() {
  const [billing, setBilling] = useState<Billing>("monthly");
  const annual = billing === "annual";
  const toggleClass = (active: boolean) => `rounded-full px-4 py-2 text-sm font-semibold ${active ? "bg-ink text-white" : "text-ink-3"}`;

  return (
    <section id="precios" aria-labelledby="precios-title" className="container-page scroll-mt-24 pb-[clamp(40px,6vw,80px)]">
      <h2 id="precios-title" className="m-0 mb-2 text-[clamp(28px,3.4vw,40px)] tracking-[-0.03em]">Precios simples, sin sobrecosto de IA</h2>
      <p className="m-0 mb-6 max-w-[62ch] text-ink-3">Usa tu propia clave de IA (BYOK) y pagas al proveedor lo que consumes, sin margen nuestro sobre la IA.</p>
      <div role="group" aria-label="Periodo de facturación" className="mb-6 inline-flex gap-1 rounded-full border border-line bg-white p-1">
        <button type="button" aria-pressed={!annual} onClick={() => setBilling("monthly")} className={toggleClass(!annual)}>Mensual</button>
        <button type="button" aria-pressed={annual} onClick={() => setBilling("annual")} className={toggleClass(annual)}>Anual · 2 meses gratis</button>
      </div>
      <ul className="m-0 grid list-none grid-cols-1 gap-4 p-0 md:grid-cols-2">
        {PLANS.map((plan) => (
          <li key={plan.name} className={`flex flex-col gap-4 rounded-[22px] border bg-white p-6 ${plan.highlight ? "border-ink" : "border-line"}`}>
            <h3 className="m-0 text-[22px]">{plan.name}</h3>
            <p className="m-0 text-ink-3">{plan.tagline}</p>
            <p className="m-0 text-[40px] leading-none font-extrabold tracking-[-0.03em]">
              {annual ? format(plan.monthly * 10) : format(plan.monthly)}
              <span className="text-base font-medium text-ink-3">{annual ? " /año" : " /mes"}</span>
            </p>
            {annual ? <p className="m-0 text-sm text-ink-3">Pagas 10 meses, usas 12.</p> : null}
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {plan.features.map((feature) => (
                <li key={feature} className="flex items-start gap-2">
                  <Check aria-hidden className="mt-0.5 size-5 shrink-0" />
                  <span>{feature}</span>
                </li>
              ))}
            </ul>
            <Link href="/signup" className={`${buttonClasses(plan.highlight ? "accent" : "outline", "", "lg")} mt-auto`}>
              Empezar con {plan.name}
            </Link>
          </li>
        ))}
      </ul>
      <p className="mt-4 mb-0 text-ink-3">Número de WhatsApp adicional: +US$29/mes. Los costos de mensajería del proveedor de WhatsApp y de tu clave de IA se pagan directamente al proveedor.</p>
    </section>
  );
}
