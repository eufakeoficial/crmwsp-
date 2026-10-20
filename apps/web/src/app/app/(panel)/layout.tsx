import type { ReactNode } from "react";
import { PanelShell } from "@/components/app/PanelShell";
import { NotificationBell } from "@/components/app/notifications/NotificationBell";

export default function PanelLayout({ children }: { children: ReactNode }) {
  return (
    <PanelShell>
      <div className="sticky top-0 z-40 -mb-2 flex justify-end pb-2">
        <NotificationBell />
      </div>
      {children}
    </PanelShell>
  );
}
