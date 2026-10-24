import type { ReactNode } from "react";
import { PanelShell } from "@/components/app/PanelShell";
import { TrialBanner } from "@/components/app/billing/TrialBanner";
import { BusinessCategoryBanner } from "@/components/settings/BusinessCategoryBanner";
import { TenantStatusGate } from "@/components/platform/TenantStatusGate";

export default function PanelLayout({ children }: { children: ReactNode }) {
  return (
    <TenantStatusGate>
      <PanelShell>
        <TrialBanner />
        <BusinessCategoryBanner />
        {children}
      </PanelShell>
    </TenantStatusGate>
  );
}
