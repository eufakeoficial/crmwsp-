"use client";

import type { ReactNode } from "react";
import { AppShell } from "./AppShell";
import { useSession } from "./SessionProvider";
import { usePendingApprovals } from "@/lib/hooks/use-pending-approvals";
import { canManageAi } from "./roles";
import { TenantEventsProvider, useSupportUnread, useUnreadOpen } from "./TenantEventsProvider";

function Counted({ children }: { children: ReactNode }) {
  const unread = useUnreadOpen();
  const support = useSupportUnread();
  const { tenant } = useSession();
  const approvals = usePendingApprovals(canManageAi(tenant?.role));
  const counts: Record<string, number> = {};
  if (unread > 0) counts["inbox"] = unread;
  if (support > 0) counts["support"] = support;
  if (approvals > 0) {
    counts["settings"] = approvals;
    counts["settings-approvals"] = approvals;
  }
  return <AppShell counts={counts}>{children}</AppShell>;
}

/**
 * Panel layout: shared SSE connection + sidebar counters. Keyed by tenant so a switch unmounts
 * every panel screen in the same commit: no state (conversations, counters, open stream) of the
 * previous tenant survives a single frame, and the old EventSource closes before the new one opens.
 */
export function PanelShell({ children }: { children: ReactNode }) {
  const { tenant } = useSession();
  return (
    <TenantEventsProvider key={tenant?.id ?? "none"}>
      <Counted>{children}</Counted>
    </TenantEventsProvider>
  );
}
