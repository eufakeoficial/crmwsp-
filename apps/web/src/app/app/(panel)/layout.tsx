import type { ReactNode } from "react";
import { PanelShell } from "@/components/app/PanelShell";

export default function PanelLayout({ children }: { children: ReactNode }) {
  return <PanelShell>{children}</PanelShell>;
}
