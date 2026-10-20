import type { ReactNode } from "react";
import { AdminShell } from "@/components/admin-shell/AdminShell";
import { PlatformGate } from "@/components/platform/PlatformGate";

/** SaaS backoffice: only platform admins (GET /platform/me); everyone else sees a 404 page. */
export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <PlatformGate>
      <AdminShell>{children}</AdminShell>
    </PlatformGate>
  );
}
