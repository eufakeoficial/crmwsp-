"use client";

import type { Message } from "@crmwsp/contracts";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui";
import { formatDayLabel } from "@/lib/format";
import { MessageBubble } from "./MessageBubble";

const NEAR_BOTTOM_PX = 140;
const NEAR_TOP_PX = 60;

/** Scrollable timeline: sticks to the bottom for new messages and loads older ones when scrolling up. */
export function MessageTimeline({
  conversationId,
  messages,
  hasOlder,
  loadingOlder,
  onLoadOlder,
}: {
  conversationId: string;
  messages: readonly Message[];
  hasOlder: boolean;
  loadingOlder: boolean;
  onLoadOlder: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const heightBeforeOlder = useRef<number | null>(null);
  const tail = messages[messages.length - 1];
  const tailId = tail?.id;
  // Screen readers: only messages arriving after the first load are announced, never the history.
  const [announcement, setAnnouncement] = useState("");
  const seenTail = useRef<string | null>(null);

  useLayoutEffect(() => {
    stick.current = true;
    heightBeforeOlder.current = null;
    seenTail.current = null;
    setAnnouncement("");
  }, [conversationId]);

  useEffect(() => {
    if (!tail) return;
    const key = tail.clientMessageId ?? tail.id;
    if (seenTail.current !== null && seenTail.current !== key && tail.direction === "inbound") {
      setAnnouncement(`Nuevo mensaje: ${tail.body ?? "adjunto"}`);
    }
    seenTail.current = key;
  }, [tail]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (heightBeforeOlder.current !== null) {
      // Older messages were prepended: keep the visible position.
      el.scrollTop += el.scrollHeight - heightBeforeOlder.current;
      heightBeforeOlder.current = null;
    } else if (stick.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages.length, tailId]);

  function loadOlder() {
    heightBeforeOlder.current = ref.current?.scrollHeight ?? null;
    onLoadOlder();
  }

  function onScroll() {
    const el = ref.current;
    if (!el) return;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
    if (el.scrollTop < NEAR_TOP_PX && hasOlder && !loadingOlder) loadOlder();
  }

  let day = "";
  return (
    <>
    <p aria-live="polite" className="sr-only" data-testid="timeline-live">{announcement}</p>
    <div ref={ref} onScroll={onScroll} data-testid="timeline" aria-label="Mensajes" className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto bg-paper-2 p-3 sm:p-4">
      {hasOlder ? (
        <Button size="sm" variant="ghost" className="self-center" disabled={loadingOlder} onClick={loadOlder}>
          {loadingOlder ? "Cargando…" : "Cargar mensajes anteriores"}
        </Button>
      ) : null}
      {messages.map((m) => {
        const label = formatDayLabel(m.createdAt);
        const header = label !== day ? label : null;
        day = label;
        return (
          <div key={m.clientMessageId ?? m.id} className="flex flex-col gap-2">
            {header ? <span className="self-center rounded-full bg-white px-3 py-0.5 text-xs font-bold text-muted">{header}</span> : null}
            <MessageBubble message={m} />
          </div>
        );
      })}
    </div>
    </>
  );
}
