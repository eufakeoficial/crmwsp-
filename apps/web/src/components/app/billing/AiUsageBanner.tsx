"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { aiUsageWarning, type AiUsageWarning } from "@crmwsp/contracts";
import { Bot } from "lucide-react";
import { canManageAi } from "@/components/app/roles";
import { useSession } from "@/components/app/SessionProvider";
import { Banner } from "@/components/ui";
import { billingApi } from "@/lib/billing-api";

const fmt = (n: number) => n.toLocaleString("es");

/** Warns owners/admins when the SaaS-credit AI usage reaches 80% of the plan cap (not shown with an own key). */
export function AiUsageBanner() {
  const { tenant } = useSession();
  const allowed = canManageAi(tenant?.role);
  const [warning, setWarning] = useState<AiUsageWarning | null>(null);
  useEffect(() => {
    if (!allowed) return;
    // Informative only: a failure must never get in the way of the page.
    billingApi.plan().then((p) => setWarning(aiUsageWarning(p.usage)), () => undefined);
  }, [allowed]);
  if (!allowed || !warning) return null;
  return (
    <div data-testid="ai-usage-banner">
      <Banner tone="info" icon={Bot}>
        <b>{warning.exhausted ? "Llegaste al límite de mensajes de IA de tu plan." : `Ya usaste el ${warning.percent}% de los mensajes de IA de tu plan.`}</b>{" "}
        {fmt(warning.used)} de {fmt(warning.limit)} este mes.{" "}
        {warning.exhausted ? "La IA deja de responder hasta el próximo período." : "Cuando se agoten, la IA deja de responder hasta el próximo período."}{" "}
        <Link href="/app/settings/billing" className="font-semibold underline">Mejorar plan</Link> o{" "}
        <Link href="/app/settings/ai" className="font-semibold underline">usar tu propia clave de IA</Link>.
      </Banner>
    </div>
  );
}
