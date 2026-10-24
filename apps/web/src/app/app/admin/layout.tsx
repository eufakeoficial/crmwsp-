import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AdminShell } from "@/components/admin-shell/AdminShell";
import { PlatformGate } from "@/components/platform/PlatformGate";

export const metadata: Metadata = {
  title: { absolute: "Administración | Vende+ WSP" },
  robots: { index: false, follow: false, nocache: true },
};

/** SaaS backoffice: only platform admins (GET /platform/me); everyone else sees a 404 page. */
export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <PlatformGate>
      <AdminShell>{children}</AdminShell>
    </PlatformGate>
  );
}
