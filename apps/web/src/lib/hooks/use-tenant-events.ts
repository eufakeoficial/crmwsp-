"use client";

import { type InboxEvent, inboxEventSchema } from "@crmwsp/contracts";
import { useEffect, useRef, useState } from "react";

export type EventsStatus = "idle" | "connecting" | "open" | "reconnecting" | "limited" | "unauthorized";

const EVENT_TYPES: readonly InboxEvent["type"][] = ["message.received", "message.created", "message.status", "conversation.updated"];
const BASE_DELAY_MS = 1_000;
const MAX_DELAY_MS = 30_000;

/** Exponential backoff with a cap: 1 s, 2 s, 4 s ... 30 s. */
export function backoffDelay(attempt: number): number {
  return Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** attempt);
}

/**
 * EventSource only reports "error", never the HTTP status. After a failure we probe the
 * endpoint with fetch to tell a 429 (too many streams: do not retry in a loop) or a 401/403
 * from a plain network drop.
 */
async function probe(url: string): Promise<"limited" | "unauthorized" | "retry"> {
  const ctrl = new AbortController();
  try {
    const res = await fetch(url, { credentials: "include", headers: { accept: "text/event-stream" }, signal: ctrl.signal });
    if (res.status === 429) return "limited";
    if (res.status === 401 || res.status === 403) return "unauthorized";
    return "retry";
  } catch {
    return "retry";
  } finally {
    ctrl.abort();
  }
}

/**
 * Subscribes to /api/events?tenantId=... (SSE through the Next rewrite). Closes on tenant change
 * or unmount, reconnects with backoff and calls `onResync` after every reconnect because events
 * are best effort (ADR 0007). Stops on 429 and reports it through `status`.
 */
export function useTenantEvents(
  tenantId: string | null,
  onEvent: (event: InboxEvent) => void,
  onResync?: () => void,
): EventsStatus {
  const [status, setStatus] = useState<EventsStatus>("idle");
  const handlers = useRef({ onEvent, onResync });
  useEffect(() => {
    handlers.current = { onEvent, onResync };
  });

  useEffect(() => {
    if (tenantId === null) {
      setStatus("idle");
      return;
    }
    const url = `/api/events?tenantId=${encodeURIComponent(tenantId)}`;
    let source: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    let everOpened = false;
    let cancelled = false;

    const connect = () => {
      if (cancelled) return;
      setStatus(everOpened ? "reconnecting" : "connecting");
      const es = new EventSource(url, { withCredentials: true });
      source = es;
      es.onopen = () => {
        const wasReconnect = everOpened;
        attempt = 0;
        everOpened = true;
        setStatus("open");
        if (wasReconnect) handlers.current.onResync?.();
      };
      const listener = (msg: MessageEvent) => {
        try {
          const parsed = inboxEventSchema.safeParse(JSON.parse(String(msg.data)));
          if (parsed.success) handlers.current.onEvent(parsed.data);
        } catch {
          // Malformed frame: ignore, the next refresh will catch up.
        }
      };
      for (const type of EVENT_TYPES) es.addEventListener(type, listener as EventListener);
      es.onerror = () => {
        es.close();
        if (source === es) source = null;
        void probe(url).then((result) => {
          if (cancelled) return;
          if (result !== "retry") {
            setStatus(result);
            return;
          }
          setStatus("reconnecting");
          timer = setTimeout(connect, backoffDelay(attempt++));
        });
      };
    };

    connect();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      source?.close();
      source = null;
    };
  }, [tenantId]);

  return status;
}
