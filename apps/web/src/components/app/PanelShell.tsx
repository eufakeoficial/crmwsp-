"use client";

import type { ReactNode } from "react";
import { AppShell } from "./AppShell";
import { useSession } from "./SessionProvider";
import { TenantEventsProvider, useUnreadOpen } from "./TenantEventsProvider";

function Counted({ children }: { children: ReactNode }) {
  const unread = useUnreadOpen();
  return <AppShell counts={unread > 0 ? { inbox: unread } : {}}>{children}</AppShell>;
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
