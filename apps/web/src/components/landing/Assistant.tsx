"use client";

import type { SiteAssistantAction, SiteAssistantMessage } from "@crmwsp/contracts";
import { ArrowLeft, ChevronRight, CircleHelp, MessageCircle, Send, UserPlus, X } from "lucide-react";
import { AnimatePresence, m, useReducedMotion } from "motion/react";
import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import {
  SITE_ASSISTANT_MAX_INPUT,
  SITE_ASSISTANT_OPEN_EVENT,
  askSiteAssistant,
  friendlyError,
  openSiteAssistant,
  salesWhatsappHref,
  type OpenAssistantDetail,
} from "@/lib/site-assistant";

type View = "menu" | "chat";
interface Turn extends SiteAssistantMessage {
  action?: SiteAssistantAction | null;
  error?: boolean;
}

const GREETING = "¡Hola! Soy el asistente de Vende+ WSP. Pregúntame cómo funciona con tu WhatsApp, la IA o los cobros.";
const SUGGESTIONS = ["¿Cómo funciona con mi WhatsApp?", "¿La IA puede inventar precios?", "¿Cómo cobro a mis clientes?", "Quiero una demo"] as const;
const WHATSAPP = salesWhatsappHref(process.env["NEXT_PUBLIC_SALES_WHATSAPP"]);
const FOCUSABLE = 'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),[tabindex]:not([tabindex="-1"])';

/** Floating landing assistant: contact menu + stateless AI chat (POST /api/public/assistant). */
export function SiteAssistant() {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>("menu");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const reduce = useReducedMotion();
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  const close = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent<OpenAssistantDetail>).detail ?? {};
      setView(detail.view ?? "menu");
      setOpen(true);
    };
    window.addEventListener(SITE_ASSISTANT_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(SITE_ASSISTANT_OPEN_EVENT, onOpen);
  }, []);

  // Move focus into the dialog when it opens or the view changes.
  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => {
      if (view === "chat") inputRef.current?.focus();
      else panelRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [open, view]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: reduce ? "auto" : "smooth" });
  }, [turns, pending, reduce]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      close();
      return;
    }
    if (e.key !== "Tab" || !panelRef.current) return;
    const items = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) return;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const send = async (text: string) => {
    const content = text.trim().slice(0, SITE_ASSISTANT_MAX_INPUT);
    if (!content || pending) return;
    const next: Turn[] = [...turns, { role: "user", content }];
    setTurns(next);
    setInput("");
    setPending(true);
    try {
      const history = next.filter((t) => !t.error).map(({ role, content: c }) => ({ role, content: c }));
      const res = await askSiteAssistant(history);
      setTurns((t) => [...t, { role: "assistant", content: res.reply, action: res.action }]);
    } catch (err) {
      setTurns((t) => [...t, { role: "assistant", content: friendlyError(err), error: true }]);
    } finally {
      setPending(false);
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void send(input);
  };

  const motionProps = reduce
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0.12 } }
    : { initial: { opacity: 0, y: 16, scale: 0.97 }, animate: { opacity: 1, y: 0, scale: 1 }, exit: { opacity: 0, y: 12, scale: 0.98 }, transition: { duration: 0.2, ease: [0.2, 0.7, 0.2, 1] as const } };

  return (
    <>
      <AnimatePresence>
        {open && (
          <m.div
            key="panel"
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            onKeyDown={onKeyDown}
            {...motionProps}
            className="fixed inset-x-0 bottom-0 z-50 flex max-h-[85dvh] flex-col overflow-hidden rounded-t-3xl bg-white text-ink shadow-2xl sm:inset-x-auto sm:right-5 sm:bottom-24 sm:max-h-[min(640px,calc(100dvh-8rem))] sm:w-[380px] sm:rounded-3xl"
          >
            <header className="flex items-center gap-2 bg-navy px-4 py-3 text-white">
              {view === "chat" && (
                <button type="button" onClick={() => setView("menu")} aria-label="Volver a las opciones" className="grid size-9 place-items-center rounded-full hover:bg-white/10">
                  <ArrowLeft className="size-5" aria-hidden />
                </button>
              )}
              <h2 id={titleId} className="m-0 flex-1 text-base font-semibold">{view === "chat" ? "Asistente de Vende+ WSP" : "Comunícate con nosotros:"}</h2>
              <button type="button" onClick={close} aria-label="Cerrar asistente" className="grid size-9 place-items-center rounded-full hover:bg-white/10 sm:hidden">
                <X className="size-5" aria-hidden />
              </button>
            </header>

            {view === "menu" ? (
              <div className="flex flex-col gap-4 p-4">
                <button type="button" onClick={() => setView("chat")} className="inline-flex min-h-14 items-center justify-center gap-2 rounded-full bg-azure px-6 text-base font-semibold text-white transition hover:bg-royal">
                  <MessageCircle className="size-5" aria-hidden />
                  Chatea con el asistente
                </button>
                <p className="m-0 text-sm font-semibold text-muted">Otras opciones:</p>
                <ul className="m-0 flex list-none flex-col gap-1 p-0">
                  {WHATSAPP && (
                    <OptionRow href={WHATSAPP} external icon={<MessageCircle className="size-5" aria-hidden />} title="Escríbenos por WhatsApp" subtitle="Habla con ventas" />
                  )}
                  <OptionRow href="/signup" icon={<UserPlus className="size-5" aria-hidden />} title="Crear cuenta gratis" subtitle="Empieza hoy, sin tarjeta" onNavigate={close} />
                  <OptionRow href="#preguntas" icon={<CircleHelp className="size-5" aria-hidden />} title="Preguntas frecuentes" subtitle="Respuestas rápidas" onNavigate={close} />
                </ul>
              </div>
            ) : (
              <>
                <div ref={listRef} className="flex flex-1 flex-col gap-3 overflow-y-auto p-4" aria-live="polite" aria-busy={pending}>
                  <Bubble role="assistant">{GREETING}</Bubble>
                  {turns.length === 0 && (
                    <div className="flex flex-wrap gap-2" role="group" aria-label="Preguntas sugeridas">
                      {SUGGESTIONS.map((s) => (
                        <button key={s} type="button" onClick={() => void send(s)} className="rounded-full border border-line-2 px-3 py-1.5 text-left text-sm hover:border-azure hover:text-azure">
                          {s}
                        </button>
                      ))}
                    </div>
                  )}
                  {turns.map((t, i) => (
                    <div key={i} className={`flex flex-col gap-2 ${t.role === "user" ? "items-end" : "items-start"}`}>
                      <Bubble role={t.role}>{t.content}</Bubble>
                      {t.action && <ActionButton action={t.action} onNavigate={close} />}
                    </div>
                  ))}
                  {pending && (
                    <p className="m-0 text-sm text-muted" role="status">
                      Pensando…
                    </p>
                  )}
                </div>
                <form onSubmit={onSubmit} className="flex items-end gap-2 border-t border-line p-3">
                  <label htmlFor={`${titleId}-input`} className="sr-only">Escribe tu pregunta</label>
                  <textarea
                    id={`${titleId}-input`}
                    ref={inputRef}
                    rows={1}
                    value={input}
                    maxLength={SITE_ASSISTANT_MAX_INPUT}
                    onChange={(e) => setInput(e.target.value.slice(0, SITE_ASSISTANT_MAX_INPUT))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        void send(input);
                      }
                    }}
                    placeholder="Escribe tu pregunta…"
                    className="max-h-28 min-h-11 flex-1 resize-none rounded-2xl border border-line-2 px-3 py-2.5 text-sm outline-none focus:border-azure"
                  />
                  <button type="submit" disabled={pending || input.trim() === ""} aria-label="Enviar mensaje" className="grid size-11 shrink-0 place-items-center rounded-full bg-azure text-white disabled:opacity-40">
                    <Send className="size-5" aria-hidden />
                  </button>
                </form>
              </>
            )}
          </m.div>
        )}
      </AnimatePresence>

      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? close() : (setView("menu"), setOpen(true)))}
        aria-label={open ? "Cerrar asistente" : "Abrir asistente: comunícate con nosotros"}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={`fixed right-5 bottom-5 z-50 grid size-14 place-items-center rounded-full bg-lime text-navy shadow-[0_10px_30px_rgba(5,10,58,0.35)] ring-2 ring-navy/10 transition-transform hover:scale-105 motion-reduce:transition-none motion-reduce:hover:scale-100 ${open ? "max-sm:hidden" : ""}`}
      >
        <AnimatePresence initial={false} mode="wait">
          <m.span
            key={open ? "x" : "chat"}
            initial={reduce ? { opacity: 0 } : { opacity: 0, rotate: -90, scale: 0.6 }}
            animate={reduce ? { opacity: 1 } : { opacity: 1, rotate: 0, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, rotate: 90, scale: 0.6 }}
            transition={{ duration: 0.15 }}
            className="grid place-items-center"
          >
            {open ? <X className="size-6" aria-hidden /> : <MessageCircle className="size-6" aria-hidden />}
          </m.span>
        </AnimatePresence>
      </button>
    </>
  );
}

function Bubble({ role, children }: { role: "user" | "assistant"; children: ReactNode }) {
  return (
    <p className={`m-0 max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere] ${role === "user" ? "self-end bg-navy text-white" : "self-start bg-paper text-ink"}`}>
      <span className="sr-only">{role === "user" ? "Tú: " : "Asistente: "}</span>
      {children}
    </p>
  );
}

/** Only same-site or wa.me targets reach here (validated by the response schema). */
function ActionButton({ action, onNavigate }: { action: SiteAssistantAction; onNavigate: () => void }) {
  const cls = "inline-flex min-h-10 items-center gap-1.5 rounded-full bg-lime px-4 text-sm font-semibold text-navy no-underline hover:brightness-95";
  if (action.href.startsWith("https://")) {
    return (
      <a href={action.href} target="_blank" rel="noopener noreferrer" className={cls}>
        {action.label}
        <ChevronRight className="size-4" aria-hidden />
      </a>
    );
  }
  return (
    <Link href={action.href} onClick={onNavigate} className={cls}>
      {action.label}
      <ChevronRight className="size-4" aria-hidden />
    </Link>
  );
}

function OptionRow({ href, icon, title, subtitle, external = false, onNavigate }: { href: string; icon: ReactNode; title: string; subtitle: string; external?: boolean; onNavigate?: () => void }) {
  const body = (
    <>
      <span className="grid size-10 shrink-0 place-items-center rounded-full bg-royal-soft text-royal">{icon}</span>
      <span className="flex flex-1 flex-col">
        <span className="text-sm font-semibold">{title}</span>
        <span className="text-xs text-muted">{subtitle}</span>
      </span>
      <ChevronRight className="size-4 text-muted" aria-hidden />
    </>
  );
  const cls = "flex items-center gap-3 rounded-2xl px-2 py-2.5 text-ink no-underline hover:bg-paper";
  return (
    <li>
      {external ? (
        <a href={href} target="_blank" rel="noopener noreferrer" className={cls}>{body}</a>
      ) : (
        <Link href={href} {...(onNavigate ? { onClick: onNavigate } : {})} className={cls}>{body}</Link>
      )}
    </li>
  );
}

/** Secondary CTA that opens the assistant from server-rendered sections. */
export function AssistantCta({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <button type="button" onClick={() => openSiteAssistant({ view: "chat" })} className={className}>
      {children}
    </button>
  );
}
