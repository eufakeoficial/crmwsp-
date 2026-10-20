"use client";

import { Clock, Send } from "lucide-react";
import { type KeyboardEvent, useRef, useState } from "react";
import { Banner, Button, Textarea } from "@/components/ui";
import { TemplatePicker } from "./TemplatePicker";

export const MAX_MESSAGE_LENGTH = 4096;
export const WINDOW_NOTICE =
  "Pasaron más de 24 h desde el último mensaje del cliente: WhatsApp exige una plantilla aprobada.";

/** Enter sends, Shift+Enter inserts a line break. `blocked` (server said 422) disables it; `windowWarning` only warns. */
export function Composer({
  blocked,
  windowWarning,
  onSend,
  channelConnectionId,
  onSendTemplate,
}: {
  blocked: boolean;
  windowWarning: boolean;
  onSend: (text: string) => Promise<void>;
  /** With both set, a closed window offers the approved-template picker. */
  channelConnectionId?: string;
  onSendTemplate?: (templateId: string, params: string[]) => Promise<boolean>;
}) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  // Synchronous guard: repeated Enter fires before React re-renders with `sending`.
  const inFlight = useRef(false);
  const trimmed = text.trim();
  const tooLong = text.length > MAX_MESSAGE_LENGTH;
  const canSend = !blocked && !sending && trimmed.length > 0 && !tooLong;

  function submit() {
    if (!canSend || inFlight.current) return;
    inFlight.current = true;
    setSending(true);
    setText("");
    void onSend(trimmed).finally(() => {
      inFlight.current = false;
      setSending(false);
    });
  }
  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  }

  return (
    <div className="flex flex-col gap-2 border-t border-line bg-white p-3">
      {blocked || windowWarning ? <Banner tone="info" icon={Clock}>{WINDOW_NOTICE}</Banner> : null}
      {(blocked || windowWarning) && channelConnectionId && onSendTemplate ? (
        <TemplatePicker channelConnectionId={channelConnectionId} onSend={onSendTemplate} />
      ) : null}
      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <Textarea
            aria-label="Escribe un mensaje"
            rows={2}
            value={text}
            disabled={blocked}
            // readOnly (not disabled) keeps the focus for the next message.
            readOnly={sending}
            aria-busy={sending}
            placeholder={blocked ? "Envío de texto libre bloqueado (ventana de 24 h)" : "Escribe un mensaje…"}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            className="max-h-40 min-h-[52px] py-2.5 text-[15px]"
          />
          <p className="m-0 mt-1 flex justify-between gap-2 text-xs text-muted">
            <span className="hidden sm:inline">Enter envía · Shift+Enter salto de línea</span>
            <span aria-live="polite" className={`ml-auto ${tooLong ? "font-bold text-danger" : ""}`}>
              {text.length}/{MAX_MESSAGE_LENGTH}
            </span>
          </p>
        </div>
        <Button variant="accent" aria-label="Enviar mensaje" disabled={!canSend} onClick={submit} className="mb-6 size-12 px-0">
          <Send aria-hidden className="size-5" />
        </Button>
      </div>
    </div>
  );
}
