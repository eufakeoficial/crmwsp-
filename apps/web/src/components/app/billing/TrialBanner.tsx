"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { BillingPlanResponse } from "@crmwsp/contracts";
import { canManageAi } from "@/components/app/roles";
import { useSession } from "@/components/app/SessionProvider";
import { billingApi } from "@/lib/billing-api";
import { trialBannerText } from "@/lib/trial-banner";

type Subscription = BillingPlanResponse["subscription"];

/** Days-left banner of the trial lifecycle (ADR 0015). Only owners/admins can read the plan. */
export function TrialBanner() {
  const { tenant } = useSession();
  const allowed = canManageAi(tenant?.role);
  const [sub, setSub] = useState<Subscription>();
  useEffect(() => {
    if (!allowed) return;
    billingApi.plan().then((p) => setSub(p.subscription), () => undefined);
  }, [allowed, tenant?.id]);
  const text = sub ? trialBannerText(sub) : null;
  if (!text || !sub) return null;
  const href = sub.access === "setup" ? "/app/channels" : "/app/settings/billing";
  const tone = sub.access === "restricted" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-800";
  return (
    <div role="status" className={`mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl px-3 py-2 text-sm font-semibold ${tone}`}>
      <span>{text}</span>
      <Link href={href} className="underline">
        {sub.access === "setup" ? "Conectar WhatsApp" : "Ver suscripción"}
      </Link>
    </div>
  );
}
