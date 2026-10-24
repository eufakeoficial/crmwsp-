"use client";

import type { InboxEvent, SupportEvent, ThreadEvent } from "@crmwsp/contracts";
import { type ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { type EventsStatus, useTenantEvents } from "@/lib/hooks/use-tenant-events";
import { APPROVALS_CHANGED } from "@/lib/ai-actions";
import { conversationsApi } from "@/lib/inbox-api";
import { SUPPORT_CHANGED, SUPPORT_READ, supportApi } from "@/lib/support-api";
import { useSession } from "./SessionProvider";

/** Inbox listeners get thread events (incl. ai.reply_drafted / ai.handoff, which carry conversationId) and resyncs. */
export type ThreadOrResync = ThreadEvent | Extract<InboxEvent, { conversationId: string }> | { type: "resync" };
type Listener = (event: ThreadOrResync) => void;

interface EventsValue {
  status: EventsStatus;
  /** Registers a listener; returns the unsubscribe function. */
  subscribe: (listener: Listener) => () => void;
  /** Open conversations with unread messages (sidebar counter). */
  unreadOpen: number;
  /** Support tickets with a support reply not yet opened (sidebar counter). */
  supportUnread: number;
}

const EventsContext = createContext<EventsValue | null>(null);

export function useInboxEvents(listener: Listener): EventsStatus {
  const ctx = useContext(EventsContext);
  if (!ctx) throw new Error("useInboxEvents must be used inside TenantEventsProvider");
  const ref = useRef(listener);
  useEffect(() => {
    ref.current = listener;
  });
  const { subscribe } = ctx;
  useEffect(() => subscribe((e) => ref.current(e)), [subscribe]);
  return ctx.status;
}

export function useUnreadOpen(): number {
  return useContext(EventsContext)?.unreadOpen ?? 0;
}

export function useSupportUnread(): number {
  return useContext(EventsContext)?.supportUnread ?? 0;
}

const MAX_PAGES = 5;

async function countUnreadOpen(): Promise<number> {
  let cursor: string | null = null;
  let total = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await conversationsApi.list({ status: "open", cursor, limit: 100 });
    total += res.items.filter((c) => c.unreadCount > 0).length;
    if (!res.nextCursor) break;
    cursor = res.nextCursor;
  }
  return total;
}

/** One SSE connection per tab, shared by the sidebar counter and the inbox. */
export function TenantEventsProvider({ children }: { children: ReactNode }) {
  const { tenant } = useSession();
  const tenantId = tenant?.id ?? null;
  const listeners = useRef(new Set<Listener>());
  const [unreadOpen, setUnreadOpen] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const refreshCount = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      countUnreadOpen().then(setUnreadOpen, () => undefined);
    }, 300);
  }, []);

  useEffect(() => {
    setUnreadOpen(0);
    if (tenantId !== null) refreshCount();
    return () => clearTimeout(timer.current);
  }, [tenantId, refreshCount]);

  const dispatch = useCallback(
    (event: InboxEvent | { type: "resync" }) => {
      // Approvals badge (usePendingApprovals listens to this window event).
      if (event.type === "ai.action_pending" && typeof window !== "undefined") window.dispatchEvent(new Event(APPROVALS_CHANGED));
      if (event.type === "ai.budget_warning") return;
      refreshCount();
      // message.created / ai.reply_drafted refresh the open thread and the list in the inbox.
      for (const l of listeners.current) l(event);
    },
    [refreshCount],
  );
  // Support tickets (ADR 0016): sidebar badge + window event so the Soporte page refetches.
  const [supportUnread, setSupportUnread] = useState(0);
  const refreshSupport = useCallback(() => {
    supportApi.unreadCount().then((r) => setSupportUnread(r.unreadCount), () => undefined);
  }, []);
  useEffect(() => {
    setSupportUnread(0);
    if (tenantId !== null) refreshSupport();
  }, [tenantId, refreshSupport]);
  const onSupport = useCallback(
    (e: SupportEvent) => {
      refreshSupport();
      if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(SUPPORT_CHANGED, { detail: e.ticketId }));
    },
    [refreshSupport],
  );
  useEffect(() => {
    // The Soporte page marks threads as read: it fires the same event to refresh the badge.
    const onLocal = () => refreshSupport();
    window.addEventListener(SUPPORT_READ, onLocal);
    return () => window.removeEventListener(SUPPORT_READ, onLocal);
  }, [refreshSupport]);

  const status = useTenantEvents(
    tenantId,
    dispatch,
    () => {
      dispatch({ type: "resync" });
      refreshSupport();
    },
    onSupport,
  );
  const subscribe = useCallback((l: Listener) => {
    listeners.current.add(l);
    return () => {
      listeners.current.delete(l);
    };
  }, []);

  const value = useMemo(() => ({ status, subscribe, unreadOpen, supportUnread }), [status, subscribe, unreadOpen, supportUnread]);
  return <EventsContext.Provider value={value}>{children}</EventsContext.Provider>;
}
