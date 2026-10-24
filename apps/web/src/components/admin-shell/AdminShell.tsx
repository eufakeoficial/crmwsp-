"use client";

import { usePathname } from "next/navigation";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { usePlatformSupportEvents } from "@/lib/hooks/use-platform-support-events";
import { SUPPORT_CHANGED, SUPPORT_READ, platformSupportApi } from "@/lib/support-api";
import { AdminSidebar } from "./AdminSidebar";
import { AdminTopbar } from "./AdminTopbar";

/**
 * One support SSE stream per backoffice tab: refreshes the "Tickets" counter and re-broadcasts
 * each update as a window event for the inbox page.
 */
function useSupportCounter(): number {
  const [count, setCount] = useState(0);
  const refresh = useCallback(() => {
    platformSupportApi.unreadCount().then((r) => setCount(r.unreadCount), () => undefined);
  }, []);
  useEffect(() => {
    refresh();
    window.addEventListener(SUPPORT_READ, refresh);
    return () => window.removeEventListener(SUPPORT_READ, refresh);
  }, [refresh]);
  usePlatformSupportEvents(
    true,
    (ticketId) => {
      refresh();
      window.dispatchEvent(new CustomEvent(SUPPORT_CHANGED, { detail: ticketId }));
    },
    () => {
      refresh();
      window.dispatchEvent(new CustomEvent(SUPPORT_CHANGED, { detail: null }));
    },
  );
  return count;
}

/** Backoffice shell: black header with search, white sidebar with collapsible sections. */
export function AdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const supportUnread = useSupportCounter();
  useEffect(() => setDrawerOpen(false), [pathname]);
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setDrawerOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [drawerOpen]);
  return (
    <>
      <AdminTopbar drawerOpen={drawerOpen} onToggleDrawer={() => setDrawerOpen((v) => !v)} onCloseDrawer={() => setDrawerOpen(false)} />
      <AdminSidebar drawerOpen={drawerOpen} onClose={() => setDrawerOpen(false)} counts={supportUnread > 0 ? { support: supportUnread } : {}} />
      <main className="min-w-0 px-[clamp(12px,3vw,28px)] pt-[88px] pb-16 desk:pl-[calc(264px+clamp(12px,3vw,28px))]">{children}</main>
    </>
  );
}
