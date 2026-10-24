import type { ReactNode } from "react";
import { PanelShell } from "@/components/app/PanelShell";
import { TrialBanner } from "@/components/app/billing/TrialBanner";
import { TenantStatusGate } from "@/components/platform/TenantStatusGate";

export default function PanelLayout({ children }: { children: ReactNode }) {
  return (
    <TenantStatusGate>
      <PanelShell>
        <TrialBanner />
        {children}
      </PanelShell>
    </TenantStatusGate>
  );
}
