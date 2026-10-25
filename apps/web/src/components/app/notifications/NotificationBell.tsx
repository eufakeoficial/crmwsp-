"use client";

import type { Notification } from "@crmwsp/contracts";
import { Bell } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useInboxEvents } from "@/components/app/TenantEventsProvider";
import { formatDateTime } from "@/lib/format";
import { notificationsApi } from "@/lib/notifications-api";

/** Poll interval: covers notifications that are not paired with an inbox event (e.g. Stripe paid). */
const POLL_MS = 30_000;

export function notificationHref(n: Pick<Notification, "kind" | "entity" | "entityId" | "conversationId">): string | null {
  if (n.kind === "payment_review") return "/app/payments/reviews";
  if (n.kind === "channel_quality") return "/app/channels";
  if (n.entity === "order" && n.entityId) return `/app/orders/${n.entityId}`;
  if (n.kind === "approval_requested") return "/app/settings/approvals";
  if (n.conversationId) return `/app/inbox?conversation=${n.conversationId}`;
  return null;
}

export function NotificationBell({ triggerClassName = "size-10 border border-line bg-white hover:bg-ink/5" }: { triggerClassName?: string } = {}) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[] | null>(null);
  const [unread, setUnread] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  const refresh = useCallback(() => {
    notificationsApi.list({ limit: 20 }).then(
      (res) => {
        setItems(res.items);
        setUnread(res.unreadCount);
      },
      () => undefined,
    );
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, POLL_MS);
    return () => clearInterval(t);
  }, [refresh]);

  // Handoffs and approvals arrive on the shared SSE stream: refetch right away.
  useInboxEvents((e) => {
    if (e.type === "ai.handoff" || e.type === "ai.action_pending" || e.type === "resync") refresh();
  });

  useEffect(() => {
    if (!open) return;
    const onDown = (ev: MouseEvent) => {
      if (ref.current && !ref.current.contains(ev.target as Node)) setOpen(false);
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const markRead = (n: Notification) => {
    if (n.read) return;
    setItems((cur) => cur?.map((x) => (x.id === n.id ? { ...x, read: true } : x)) ?? cur);
    notificationsApi.markRead([n.id]).then((r) => setUnread(r.unreadCount), () => undefined);
  };

  const markAll = () => {
    setItems((cur) => cur?.map((x) => ({ ...x, read: true })) ?? cur);
    notificationsApi.markAllRead().then((r) => setUnread(r.unreadCount), () => undefined);
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label={unread > 0 ? `Notificaciones (${unread} sin leer)` : "Notificaciones"}
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => {
          setOpen((v) => !v);
          if (!open) refresh();
        }}
        className={`relative grid place-items-center rounded-full ${triggerClassName}`}
      >
        <Bell className="size-5" aria-hidden />
        {unread > 0 ? (
          <span className="absolute -top-1 -right-1 min-w-5 rounded-full bg-lime px-1 text-center text-xs leading-5 font-bold text-ink">
            {unread > 99 ? "99+" : unread}
          </span>
        ) : null}
      </button>
      {open ? (
        <div
          role="dialog"
          aria-label="Notificaciones"
          className="absolute right-0 z-50 mt-2 w-[min(92vw,380px)] overflow-hidden rounded-2xl border border-line bg-white shadow-[0_16px_40px_rgba(18,18,18,.18)]"
        >
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <span className="font-bold">Notificaciones</span>
            {unread > 0 ? (
              <button type="button" onClick={markAll} className="text-sm text-muted underline">
                Marcar todo como leído
              </button>
            ) : null}
          </div>
          <ul className="m-0 max-h-[60vh] list-none overflow-y-auto p-0">
            {items === null ? <li className="px-4 py-6 text-center text-muted">Cargando…</li> : null}
            {items?.length === 0 ? <li className="px-4 py-6 text-center text-muted">Sin notificaciones</li> : null}
            {items?.map((n) => {
              const href = notificationHref(n);
              const content = (
                <>
                  <span className="flex items-start gap-2">
                    {!n.read ? <span aria-label="sin leer" className="mt-1.5 size-2 shrink-0 rounded-full bg-lime" /> : null}
                    <span className={n.read ? "text-muted" : "font-semibold"}>{n.title}</span>
                  </span>
                  {n.body ? <span className="mt-0.5 block text-sm text-muted">{n.body}</span> : null}
                  <span className="mt-1 block text-xs text-muted">{formatDateTime(n.createdAt)}</span>
                </>
              );
              return (
                <li key={n.id} className="border-b border-line last:border-b-0">
                  {href ? (
                    <Link
                      href={href}
                      onClick={() => {
                        markRead(n);
                        setOpen(false);
                      }}
                      className="block px-4 py-3 hover:bg-ink/5"
                    >
                      {content}
                    </Link>
                  ) : (
                    <button type="button" onClick={() => markRead(n)} className="block w-full px-4 py-3 text-left hover:bg-ink/5">
                      {content}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
