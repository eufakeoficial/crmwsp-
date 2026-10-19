import type { ReactNode } from "react";
import { AdminShell } from "@/components/admin-shell/AdminShell";
import { assertAdminPreviewEnabled } from "@/lib/admin-preview";

// Read ENABLE_ADMIN_PREVIEW at request time, not at build time.
export const dynamic = "force-dynamic";

export default function AdminLayout({ children }: { children: ReactNode }) {
  assertAdminPreviewEnabled();
  return <AdminShell>{children}</AdminShell>;
}
