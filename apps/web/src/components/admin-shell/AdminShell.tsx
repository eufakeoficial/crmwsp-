"use client";

import { usePathname } from "next/navigation";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { usePlatformSupportEvents } from "@/lib/hooks/use-platform-support-events";
import { EMAIL_READ, platformEmailApi } from "@/lib/email-api";
import { SUPPORT_CHANGED, SUPPORT_READ, platformSupportApi } from "@/lib/support-api";
import { AdminSidebar } from "./AdminSidebar";
import { AdminTopbar } from "./AdminTopbar";

/**
 * One support SSE stream per backoffice tab: refreshes the "Tickets" counter and re-broadcasts
 * each update as a window event for the inbox page.
 */
function useSupportCounter(): { support: number; email: number } {
  const [count, setCount] = useState({ support: 0, email: 0 });
  const refresh = useCallback(() => {
    platformSupportApi.unreadCount().then((r) => setCount((c) => ({ ...c, support: r.unreadCount })), () => undefined);
    platformEmailApi.unreadCount().then((r) => setCount((c) => ({ ...c, email: r.unreadCount })), () => undefined);
  }, []);
  useEffect(() => {
    refresh();
    window.addEventListener(SUPPORT_READ, refresh);
    window.addEventListener(EMAIL_READ, refresh);
    return () => {
      window.removeEventListener(SUPPORT_READ, refresh);
      window.removeEventListener(EMAIL_READ, refresh);
    };
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
  const unread = useSupportCounter();
  const counts: Record<string, number> = {};
  if (unread.support > 0) counts.support = unread.support;
  if (unread.email > 0) counts.email = unread.email;
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
      <AdminSidebar drawerOpen={drawerOpen} onClose={() => setDrawerOpen(false)} counts={counts} />
      <main className="min-w-0 px-[clamp(12px,3vw,28px)] pt-[88px] pb-16 desk:pl-[calc(264px+clamp(12px,3vw,28px))]">{children}</main>
    </>
  );
}
