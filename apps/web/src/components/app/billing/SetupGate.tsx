"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { canManageAi } from "@/components/app/roles";
import { useSession } from "@/components/app/SessionProvider";
import { billingApi } from "@/lib/billing-api";
import { SETUP_REQUIRED_TEXT } from "@/lib/messages";

/**
 * True while the tenant is in setup (no WhatsApp channel yet, ADR 0015). Only owners/admins can
 * read the plan; for other roles it stays false and the API's 402 SETUP_REQUIRED is the fallback.
 */
export function useSetupMode(): boolean {
  const { tenant } = useSession();
  const allowed = canManageAi(tenant?.role);
  const [setup, setSetup] = useState(false);
  useEffect(() => {
    if (!allowed) return;
    let alive = true;
    billingApi.plan().then(
      (p) => alive && setSetup(p.subscription.access === "setup"),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [allowed, tenant?.id]);
  return setup;
}

/** Spanish hint next to a disabled action, linking to Canales. */
export function SetupRequiredHint({ className = "" }: { className?: string }) {
  return (
    <p role="note" className={`m-0 text-sm text-muted ${className}`}>
      {SETUP_REQUIRED_TEXT}{" "}
      <Link href="/app/channels" className="font-semibold underline">Ir a Canales</Link>
    </p>
  );
}
