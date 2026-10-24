"use client";

import { supportEventSchema } from "@crmwsp/contracts";
import { useEffect, useRef } from "react";
import { backoffDelay } from "./use-tenant-events";

const URL = "/api/platform/support/events";
const MAX_ATTEMPTS = 8;

/**
 * Backoffice support stream (ADR 0016): `support.ticket_updated` for every tenant. Reconnects with
 * backoff and calls `onResync` after a reconnect (events are best effort). Gives up after a few
 * failed attempts in a row (e.g. the admin was revoked: the route answers 404).
 */
export function usePlatformSupportEvents(enabled: boolean, onEvent: (ticketId: string) => void, onResync?: () => void): void {
  const handlers = useRef({ onEvent, onResync });
  useEffect(() => {
    handlers.current = { onEvent, onResync };
  });
  useEffect(() => {
    if (!enabled || typeof EventSource === "undefined") return;
    let source: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    let everOpened = false;
    let cancelled = false;
    const connect = () => {
      if (cancelled) return;
      const es = new EventSource(URL, { withCredentials: true });
      source = es;
      es.onopen = () => {
        if (everOpened) handlers.current.onResync?.();
        everOpened = true;
        attempt = 0;
      };
      es.addEventListener("support.ticket_updated", ((msg: MessageEvent) => {
        try {
          const parsed = supportEventSchema.safeParse(JSON.parse(String(msg.data)));
          if (parsed.success) handlers.current.onEvent(parsed.data.ticketId);
        } catch {
          // Malformed frame: ignore.
        }
      }) as EventListener);
      es.onerror = () => {
        es.close();
        if (source === es) source = null;
        if (cancelled || attempt >= MAX_ATTEMPTS) return;
        timer = setTimeout(connect, backoffDelay(attempt++));
      };
    };
    connect();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      source?.close();
      source = null;
    };
  }, [enabled]);
}
