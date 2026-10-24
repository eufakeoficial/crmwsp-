"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { BillingPlanResponse, PlanLimitKeyDto } from "@crmwsp/contracts";
import { SettingsFrame } from "@/components/ai/AccessGate";
import { canManageAi } from "@/components/app/roles";
import { useSession } from "@/components/app/SessionProvider";
import { Alert, Card, Spinner } from "@/components/ui";
import { billingApi } from "@/lib/billing-api";
import { errorMessage } from "@/lib/messages";

const LABELS: Record<PlanLimitKeyDto, string> = {
  ai_messages: "Mensajes de IA este mes",
  broadcast_sends: "Envíos de difusión este mes",
  contacts: "Contactos",
  seats: "Usuarios",
  whatsapp_numbers: "Números de WhatsApp",
};

const fmt = (n: number) => n.toLocaleString("es");

const ACCESS_LABEL: Record<BillingPlanResponse["subscription"]["access"], string> = {
  unbilled: "Sin suscripción registrada",
  active: "Suscripción al día",
  grace: "Período vencido: en días de gracia",
  restricted: "Suscripción vencida: solo lectura (tus datos se conservan)",
  setup: "Configuración: conecta tu WhatsApp para empezar tu prueba",
  trial: "Prueba gratuita en curso",
};

function UsageRow({ item }: { item: BillingPlanResponse["usage"][number] }) {
  const { key, limit, used, percent, exceeded } = item;
  const text = limit === null ? `${fmt(used)} · ilimitado` : limit === 0 ? "No incluido en tu plan" : `${fmt(used)} de ${fmt(limit)}`;
  const tone = percent !== null && percent >= 100 ? "bg-red-600" : percent !== null && percent >= 80 ? "bg-amber-500" : "bg-ink";
  return (
    <li className="flex flex-col gap-1.5">
      <div className="flex justify-between gap-3 text-sm">
        <span className="font-semibold">{LABELS[key]}</span>
        <span className="text-ink-3">{text}</span>
      </div>
      {percent !== null ? (
        <div role="progressbar" aria-label={LABELS[key]} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className="h-2 overflow-hidden rounded-full bg-line">
          <div className={`h-full ${tone}`} style={{ width: `${percent}%` }} />
        </div>
      ) : null}
      {exceeded ? (
        <p className="m-0 text-xs font-semibold text-red-600">
          {key === "contacts"
            ? "Superaste el límite de tu plan: los mensajes de clientes nuevos se siguen recibiendo, pero no podrás importar contactos hasta mejorar el plan."
            : "Superaste el límite de tu plan."}
        </p>
      ) : null}
    </li>
  );
}

function Body() {
  const [data, setData] = useState<BillingPlanResponse>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    billingApi.plan().then(setData, (err: unknown) => setError(errorMessage(err)));
  }, []);
  if (error) return <Alert>{error}</Alert>;
  if (!data) return <Spinner />;
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <p className="m-0 text-sm text-ink-3">Plan actual</p>
        <p className="m-0 text-[28px] font-extrabold">{data.plan.name}</p>
        <p className="m-0 text-ink-3">US${data.plan.priceMonthlyUsd} /mes · período {data.period}</p>
        <p className={`m-0 mt-1 text-sm font-semibold ${data.subscription.access === "restricted" ? "text-red-600" : data.subscription.access === "grace" ? "text-amber-600" : ""}`}>
          {ACCESS_LABEL[data.subscription.access]}
          {data.subscription.paidUntil ? ` · pagado hasta el ${data.subscription.paidUntil}` : ""}
        </p>
        <p className="m-0 mt-2 text-sm text-ink-3">
          Paga o renueva tu suscripción (30 días por pago, o 365 en el plan anual; en cripto, sin cobros automáticos) desde{" "}
          <Link href="/app/settings/billing" className="font-semibold underline">
            Ajustes › Suscripción
          </Link>
          .
        </p>
      </Card>
      <Card>
        <ul className="m-0 flex list-none flex-col gap-4 p-0">
          {data.usage.map((u) => (
            <UsageRow key={u.key} item={u} />
          ))}
        </ul>
      </Card>
    </div>
  );
}

export function PlanUsageView() {
  const { tenant } = useSession();
  return (
    <SettingsFrame title="Plan y uso" subtitle="Tu plan y el consumo de este mes.">
      {() => (canManageAi(tenant?.role) ? <Body /> : <Alert>Solo propietarios y administradores ven el plan.</Alert>)}
    </SettingsFrame>
  );
}
