import type { ReactNode } from "react";
import { PanelShell } from "@/components/app/PanelShell";
import { TenantStatusGate } from "@/components/platform/TenantStatusGate";

export default function PanelLayout({ children }: { children: ReactNode }) {
  return (
    <TenantStatusGate>
      <PanelShell>{children}</PanelShell>
    </TenantStatusGate>
  );
}
