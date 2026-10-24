"use client";

import type { SupportMessage, SupportTicketPriority, SupportTicketStatus } from "@crmwsp/contracts";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/cn";
import { formatDateTime } from "@/lib/format";
import { SUPPORT_PRIORITY_LABELS, SUPPORT_STATUS_LABELS } from "@/lib/support-api";

const STATUS_CLASSES: Record<SupportTicketStatus, string> = {
  open: "bg-amber-soft text-amber-ink",
  in_progress: "bg-royal-soft text-ink",
  waiting_customer: "bg-lime-soft text-ink",
  resolved: "bg-paper text-muted",
};

export function SupportStatusPill({ status }: { status: SupportTicketStatus }) {
  return (
    <span className={cn("inline-flex rounded-full px-2 py-0.5 text-[11px] font-bold whitespace-nowrap", STATUS_CLASSES[status])}>
      {SUPPORT_STATUS_LABELS[status]}
    </span>
  );
}

export function SupportPriorityTag({ priority }: { priority: SupportTicketPriority }) {
  const hot = priority === "high" || priority === "urgent";
  return (
    <span className={cn("inline-flex rounded-full px-2 py-0.5 text-[11px] font-bold whitespace-nowrap", hot ? "bg-danger-soft text-danger" : "bg-paper text-muted")}>
      {SUPPORT_PRIORITY_LABELS[priority]}
    </span>
  );
}

/**
 * Chat-like thread. `viewer` decides which side is "mine": tenant users on the right in the
 * tenant panel, support replies on the right in the backoffice. Internal notes are amber.
 */
export function SupportMessages({ messages, viewer }: { messages: readonly SupportMessage[]; viewer: "tenant" | "admin" }) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: "end" });
  }, [messages.length]);
  return (
    <ol className="m-0 flex list-none flex-col gap-2.5 p-0" aria-label="Mensajes del ticket">
      {messages.map((m) => {
        const mine = viewer === "tenant" ? m.authorType === "tenant_user" : m.authorType === "platform_admin";
        const author = m.authorType === "platform_admin" ? (viewer === "admin" ? (m.authorName ?? "Soporte") : "Soporte") : (m.authorName ?? "Usuario");
        return (
          <li key={m.id} className={cn("flex", mine ? "justify-end" : "justify-start")}>
            <div
              className={cn(
                "max-w-[85%] rounded-[16px] px-3.5 py-2.5 text-[14px] whitespace-pre-wrap break-words",
                m.internal ? "border border-dashed border-amber-ink bg-amber-soft text-ink" : mine ? "bg-royal text-white" : "bg-paper text-ink",
              )}
            >
              <div className={cn("mb-1 text-[11px] font-bold", m.internal ? "text-amber-ink" : mine ? "text-white/80" : "text-muted")}>
                {m.internal ? "Nota interna · " : ""}
                {author} · {formatDateTime(m.createdAt)}
              </div>
              {m.body}
            </div>
          </li>
        );
      })}
      <div ref={end} />
    </ol>
  );
}
