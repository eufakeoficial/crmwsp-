"use client";

import type { CannedResponseDto } from "@crmwsp/contracts";
import { Clock, MessageSquareText, Send, Smile, Sparkles, Undo2 } from "lucide-react";
import { type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { Banner, Button } from "@/components/ui";
import { improveTextApi } from "@/lib/ai-api";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { inboxV2Api } from "@/lib/inbox-v2-api";
import { COMMON_EMOJIS, IMPROVE_STYLES } from "./inbox-meta";
import { MenuItem, Popover } from "./Popover";
import { TemplatePicker } from "./TemplatePicker";

export const MAX_MESSAGE_LENGTH = 4096;
export const MAX_NOTE_LENGTH = 4000;
export const WINDOW_NOTICE =
  "Pasaron más de 24 h desde el último mensaje del cliente: WhatsApp exige una plantilla aprobada.";

type Mode = "reply" | "note";

export function improveErrorText(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 402) return "Sin cupo de IA este mes (plan o presupuesto agotado).";
    if (err.status === 400) return "Conecta un proveedor de IA en Ajustes para usar esta función.";
  }
  return "No se pudo mejorar el texto. Inténtalo de nuevo.";
}

/**
 * Reply / internal-note composer. Enter sends, Shift+Enter inserts a line break; typing "/" opens the
 * canned responses. `slot` renders above it (e.g. the order extraction card). Media upload is not
 * offered: the send API only accepts text and templates.
 */
export function Composer({
  blocked,
  windowWarning,
  onSend,
  onSendNote,
  slot,
  channelConnectionId,
  onSendTemplate,
}: {
  blocked: boolean;
  windowWarning: boolean;
  onSend: (text: string) => Promise<void>;
  /** Resolves false when the note could not be saved (the draft is kept). */
  onSendNote: (text: string) => Promise<boolean>;
  slot?: ReactNode;
  /** With both set, a closed window offers the approved-template picker. */
  channelConnectionId?: string;
  onSendTemplate?: (templateId: string, params: string[], clientMessageId: string) => Promise<boolean>;
}) {
  const [mode, setMode] = useState<Mode>("reply");
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [improving, setImproving] = useState(false);
  const [improveError, setImproveError] = useState<string | null>(null);
  const [undo, setUndo] = useState<string | null>(null);
  const [canned, setCanned] = useState<CannedResponseDto[] | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  // Synchronous guard: repeated Enter fires before React re-renders with `sending`.
  const inFlight = useRef(false);
  const note = mode === "note";
  const limit = note ? MAX_NOTE_LENGTH : MAX_MESSAGE_LENGTH;
  const trimmed = text.trim();
  const tooLong = text.length > limit;
  const replyBlocked = !note && blocked;
  const canSend = !replyBlocked && !sending && trimmed.length > 0 && !tooLong;
  const slashQuery = text.startsWith("/") && !text.includes("\n") ? text.slice(1).toLowerCase() : null;

  useEffect(() => {
    if (slashQuery === null || canned !== null) return;
    let cancelled = false;
    inboxV2Api.cannedResponses().then(
      (r) => !cancelled && setCanned(r.items),
      () => !cancelled && setCanned([]),
    );
    return () => {
      cancelled = true;
    };
  }, [slashQuery, canned]);

  const slashMatches =
    slashQuery !== null && canned
      ? canned.filter((c) => (c.shortcut ?? "").includes(slashQuery) || c.title.toLowerCase().includes(slashQuery)).slice(0, 6)
      : [];

  function submit() {
    if (!canSend || inFlight.current) return;
    inFlight.current = true;
    setSending(true);
    setUndo(null);
    if (note) {
      void onSendNote(trimmed)
        .then((ok) => {
          if (ok) setText("");
        })
        .finally(() => {
          inFlight.current = false;
          setSending(false);
        });
      return;
    }
    setText("");
    void onSend(trimmed).finally(() => {
      inFlight.current = false;
      setSending(false);
    });
  }
  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (slashMatches.length > 0 && slashMatches[0]) {
        pick(slashMatches[0]);
        return;
      }
      submit();
    }
  }
  function pick(c: CannedResponseDto) {
    setText(c.body);
    setUndo(null);
    area.current?.focus();
  }
  function insertEmoji(emoji: string) {
    const el = area.current;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    setText(text.slice(0, start) + emoji + text.slice(end));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + emoji.length, start + emoji.length);
    });
  }
  async function improve(style: (typeof IMPROVE_STYLES)[number]["style"]) {
    if (improving || trimmed.length === 0) return;
    setImproving(true);
    setImproveError(null);
    const before = text;
    try {
      const res = await improveTextApi.improve(trimmed, style);
      setUndo(before);
      setText(res.text);
    } catch (err) {
      setImproveError(improveErrorText(err));
    } finally {
      setImproving(false);
    }
  }

  const showWindow = !note && (blocked || windowWarning);
  return (
    <div className="flex flex-col gap-2 border-t border-line bg-white p-3">
      {slot}
      <div role="tablist" aria-label="Tipo de mensaje" className="flex gap-1.5">
        {(["reply", "note"] as const).map((m) => (
          <button
            key={m}
            role="tab"
            type="button"
            aria-selected={mode === m}
            onClick={() => setMode(m)}
            className={cn("h-8 cursor-pointer rounded-full px-3.5 text-[13px] font-bold", mode === m ? (m === "note" ? "bg-gold text-ink" : "bg-ink text-white") : "bg-paper text-ink hover:bg-line")}
          >
            {m === "reply" ? "Responder" : "Nota"}
          </button>
        ))}
      </div>
      {showWindow ? <Banner tone="info" icon={Clock}>{WINDOW_NOTICE}</Banner> : null}
      {showWindow && channelConnectionId && onSendTemplate ? (
        <TemplatePicker channelConnectionId={channelConnectionId} onSend={onSendTemplate} />
      ) : null}
      <div className="relative">
        {slashMatches.length > 0 ? (
          <ul role="listbox" aria-label="Respuestas predefinidas" className="absolute right-0 bottom-full left-0 z-20 m-0 mb-1 flex list-none flex-col gap-0.5 rounded-2xl border border-line bg-white p-1.5 shadow-[0_12px_32px_rgba(18,18,18,.18)]">
            {slashMatches.map((c) => (
              <li key={c.id} role="option" aria-selected={false}>
                <MenuItem onClick={() => pick(c)}>
                  <b className="flex-none">{c.shortcut ? `/${c.shortcut}` : c.title}</b>
                  <span className="min-w-0 flex-1 truncate font-normal text-muted">{c.body}</span>
                </MenuItem>
              </li>
            ))}
          </ul>
        ) : null}
        <textarea
          ref={area}
          aria-label={note ? "Escribe una nota interna" : "Escribe un mensaje"}
          rows={2}
          value={text}
          disabled={replyBlocked}
          // readOnly (not disabled) keeps the focus for the next message.
          readOnly={sending}
          aria-busy={sending || improving}
          placeholder={replyBlocked ? "Envío de texto libre bloqueado (ventana de 24 h)" : note ? "Nota visible solo para tu equipo…" : "Escribe un mensaje… (/ para respuestas predefinidas)"}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          className={cn("block max-h-40 min-h-[52px] w-full resize-none rounded-[14px] border-[1.5px] border-ink bg-white px-3.5 py-2.5 text-[15px] text-ink placeholder:text-muted disabled:cursor-not-allowed disabled:opacity-50", note && "border-gold bg-gold-soft")}
        />
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Popover label="Emoji" disabled={replyBlocked} trigger={<Smile aria-hidden className="size-[18px]" />} panelClassName="w-64">
          {(close) => (
            <div className="grid grid-cols-8 gap-0.5">
              {COMMON_EMOJIS.map((e) => (
                <button key={e} type="button" onClick={() => { insertEmoji(e); close(); }} className="grid size-8 cursor-pointer place-items-center rounded-lg bg-transparent text-[18px] hover:bg-paper">
                  {e}
                </button>
              ))}
            </div>
          )}
        </Popover>
        <CannedPicker onPick={pick} disabled={replyBlocked} />
        {note ? null : (
          <Popover label="Mejorar texto" disabled={replyBlocked || improving || trimmed.length === 0} trigger={<><Sparkles aria-hidden className="size-4" /> {improving ? "Mejorando…" : "Mejorar texto"}</>}>
            {(close) => (
              <div className="flex flex-col">
                {IMPROVE_STYLES.map((s) => (
                  <MenuItem key={s.style} onClick={() => { close(); void improve(s.style); }}>{s.label}</MenuItem>
                ))}
                <p className="m-0 px-2.5 pt-1 text-[11px] text-muted">Reescribe el borrador con IA. No se envía nada.</p>
              </div>
            )}
          </Popover>
        )}
        {undo !== null ? (
          <button type="button" onClick={() => { setText(undo); setUndo(null); }} className="inline-flex h-9 cursor-pointer items-center gap-1 rounded-full bg-paper px-3 text-[12px] font-bold hover:bg-line">
            <Undo2 aria-hidden className="size-4" /> Deshacer
          </button>
        ) : null}
        <span aria-live="polite" className={cn("ml-auto text-xs text-muted", tooLong && "font-bold text-danger")}>
          {text.length}/{limit}
        </span>
        <Button variant="accent" aria-label={note ? "Guardar nota" : "Enviar mensaje"} disabled={!canSend} onClick={submit} className="size-10 px-0">
          <Send aria-hidden className="size-5" />
        </Button>
      </div>
      {improveError ? <p role="alert" className="m-0 text-xs font-semibold text-danger">{improveError}</p> : null}
    </div>
  );
}

function CannedPicker({ onPick, disabled }: { onPick: (c: CannedResponseDto) => void; disabled: boolean }) {
  const [items, setItems] = useState<CannedResponseDto[] | null>(null);
  const [failed, setFailed] = useState(false);
  const load = () => {
    if (items !== null) return;
    inboxV2Api.cannedResponses().then(
      (r) => setItems(r.items),
      () => setFailed(true),
    );
  };
  return (
    <Popover label="Respuestas predefinidas" disabled={disabled} trigger={<MessageSquareText aria-hidden className="size-[18px]" />} panelClassName="w-72">
      {(close) => (
        <CannedList items={items} failed={failed} load={load} onPick={(c) => { onPick(c); close(); }} />
      )}
    </Popover>
  );
}

function CannedList({ items, failed, load, onPick }: { items: CannedResponseDto[] | null; failed: boolean; load: () => void; onPick: (c: CannedResponseDto) => void }) {
  // Mounted only while the popover is open: load once per opening.
  useEffect(() => load(), []);
  if (failed) return <p className="m-0 p-2 text-xs text-danger">No se pudieron cargar las respuestas.</p>;
  if (items === null) return <p className="m-0 p-2 text-xs text-muted">Cargando…</p>;
  if (items.length === 0) return <p className="m-0 p-2 text-xs text-muted">Aún no hay respuestas predefinidas.</p>;
  return (
    <div className="flex flex-col">
      {items.map((c) => (
        <MenuItem key={c.id} onClick={() => onPick(c)}>
          <span className="flex min-w-0 flex-col">
            <b className="truncate">{c.title}{c.shortcut ? <span className="font-normal text-muted"> · /{c.shortcut}</span> : null}</b>
            <span className="truncate font-normal text-muted">{c.body}</span>
          </span>
        </MenuItem>
      ))}
    </div>
  );
}
