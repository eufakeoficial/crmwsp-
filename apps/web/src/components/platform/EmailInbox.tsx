"use client";

import {
  SUPPORT_EMAIL_FOLDERS,
  SUPPORT_TICKET_STATUSES,
  type SupportCannedResponse,
  type SupportEmailFolder,
  type SupportEmailMessage,
  type SupportEmailThread,
  type SupportTicketStatus,
} from "@crmwsp/contracts";
import { Inbox, Mail, PenSquare, Send, UserCheck, CheckCircle2, Paperclip } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { PageHeader } from "@/components/app/EmptyState";
import { Button, Input, Spinner, Textarea } from "@/components/ui";
import { cn } from "@/lib/cn";
import { formatDateTime } from "@/lib/format";
import { EMAIL_FOLDER_LABELS, EMAIL_READ, emailSrcDoc, platformEmailApi } from "@/lib/email-api";
import { platformErrorMessage } from "@/lib/platform-api";
import { SUPPORT_CHANGED, SUPPORT_STATUS_LABELS, platformSupportApi, renderCannedResponse } from "@/lib/support-api";
import { SupportStatusPill } from "@/components/support/SupportParts";
import { Loading, fieldClass, useAsync } from "./shared";

const FOLDER_ICONS: Record<SupportEmailFolder, typeof Inbox> = { inbox: Inbox, mine: UserCheck, resolved: CheckCircle2, sent: Send };

function EmailBody({ message }: { message: SupportEmailMessage }) {
  if (message.html) {
    return (
      <iframe
        title="Contenido del correo"
        sandbox=""
        referrerPolicy="no-referrer"
        srcDoc={emailSrcDoc(message.html)}
        className="h-[320px] w-full rounded-lg border border-line bg-white"
      />
    );
  }
  return <p className="m-0 whitespace-pre-wrap text-[14px] text-ink">{message.body}</p>;
}

function MessageCard({ threadId, message }: { threadId: string; message: SupportEmailMessage }) {
  const who =
    message.direction === "inbound" ? (message.fromEmail ?? "Remitente") : message.direction === "note" ? `Nota · ${message.authorName ?? "admin"}` : `${message.authorName ?? "Soporte"} (contacto@vendemas.chat)`;
  return (
    <article className={cn("rounded-xl border p-3", message.direction === "note" ? "border-amber bg-amber-soft" : message.direction === "outbound" ? "border-line bg-royal-soft" : "border-line bg-white")}>
      <header className="mb-2 flex flex-wrap items-center gap-2 text-[12px] text-muted">
        <span className="font-bold text-ink">{who}</span>
        {message.toEmails.length ? <span>para {message.toEmails.join(", ")}</span> : null}
        <span className="ml-auto">{formatDateTime(message.createdAt)}</span>
      </header>
      {message.autoReason ? <p className="m-0 mb-2 text-[12px] text-muted">Respuesta automática detectada: no reabre el ticket.</p> : null}
      <EmailBody message={message} />
      {message.attachments.length ? (
        <ul className="m-0 mt-2 flex list-none flex-wrap gap-2 p-0" aria-label="Adjuntos">
          {message.attachments.map((a) => (
            <li key={a.id}>
              <a className="inline-flex items-center gap-1 rounded-lg bg-paper px-2 py-1 text-[12px] text-ink" href={platformEmailApi.attachmentUrl(threadId, a.id)} download>
                <Paperclip size={12} aria-hidden /> {a.filename}
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}

function ThreadView({ id, canned, onChanged }: { id: string; canned: readonly SupportCannedResponse[]; onChanged: () => void }) {
  const [data, setData] = useState<SupportEmailThread | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    platformEmailApi.thread(id).then(
      (t) => {
        setData(t);
        setError(null);
        window.dispatchEvent(new Event(EMAIL_READ));
      },
      (err: unknown) => setError(platformErrorMessage(err)),
    );
  }, [id]);
  useEffect(() => {
    setData(null);
    setReply("");
    load();
  }, [load]);
  useEffect(() => {
    const onEvent = (e: Event) => {
      const detail = (e as CustomEvent<string | null>).detail;
      if (detail === id || detail === null) load();
    };
    window.addEventListener(SUPPORT_CHANGED, onEvent);
    return () => window.removeEventListener(SUPPORT_CHANGED, onEvent);
  }, [id, load]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onChanged();
    } catch (err) {
      setError(platformErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (error && !data) return <p className="rounded-xl bg-danger-soft p-3 text-sm text-danger" role="alert">{error}</p>;
  if (!data) {
    return (
      <div className="flex justify-center py-10" aria-busy="true">
        <Spinner />
      </div>
    );
  }
  const t = data.thread;
  const insertCanned = (cannedId: string) => {
    const c = canned.find((x) => x.id === cannedId);
    if (!c) return;
    const text = renderCannedResponse(c.body, { nombre: t.contactName ?? "", negocio: t.tenant?.name ?? "", ticket: String(t.number), asunto: t.subject });
    setReply((r) => (r.trim() ? `${r}\n\n${text}` : text));
  };
  return (
    <div className="flex flex-col gap-3">
      <div>
        <h2 className="m-0 text-[18px] font-extrabold">{t.subject}</h2>
        <p className="m-0 mt-1 text-[12px] text-muted">
          #{t.number} · {t.contactName ? `${t.contactName} ` : ""}&lt;{t.contactEmail ?? "—"}&gt; · {t.tenant ? t.tenant.name : "Externo (sin empresa)"}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="Estado"
          className={fieldClass}
          value={t.status}
          disabled={busy}
          onChange={(e) => run(async () => setData(await platformEmailApi.update(t.id, { status: e.target.value as SupportTicketStatus })))}
        >
          {SUPPORT_TICKET_STATUSES.map((s) => (
            <option key={s} value={s}>
              {SUPPORT_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        {t.assignee ? <span className="text-[12px] text-muted">Asignado a {t.assignee.name ?? "un admin"}</span> : null}
        <Button size="sm" variant="outline" disabled={busy} onClick={() => run(async () => setData(await platformEmailApi.update(t.id, { assignToMe: !t.assignee })))}>
          {t.assignee ? "Quitar asignación" : "Asignarme"}
        </Button>
      </div>
      <div className="flex max-h-[56vh] flex-col gap-2 overflow-y-auto pr-1">
        {data.messages.map((m) => (
          <MessageCard key={m.id} threadId={t.id} message={m} />
        ))}
      </div>
      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!reply.trim()) return;
          void run(async () => {
            setData(await platformEmailApi.reply(t.id, reply));
            setReply("");
          });
        }}
      >
        <select aria-label="Insertar respuesta rápida" className={cn(fieldClass, "sm:max-w-[260px]")} value="" onChange={(e) => insertCanned(e.target.value)}>
          <option value="">Insertar respuesta rápida…</option>
          {canned.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
            </option>
          ))}
        </select>
        <Textarea aria-label="Respuesta" rows={5} maxLength={20000} value={reply} onChange={(e) => setReply(e.target.value)} placeholder={`Responder a ${t.contactEmail ?? ""}`} />
        {error ? <p className="m-0 rounded-xl bg-danger-soft p-2 text-sm text-danger" role="alert">{error}</p> : null}
        <div className="flex items-center justify-between gap-2">
          <span className="text-[12px] text-muted">Se envía desde Vende+ WSP &lt;contacto@vendemas.chat&gt;</span>
          <Button type="submit" disabled={busy || !reply.trim()}>
            Enviar respuesta
          </Button>
        </div>
      </form>
    </div>
  );
}

function ComposeForm({ onSent, onCancel }: { onSent: (id: string) => void; onCancel: () => void }) {
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        platformEmailApi.compose({ to, subject, body }).then(
          (t) => onSent(t.thread.id),
          (err: unknown) => {
            setError(platformErrorMessage(err));
            setBusy(false);
          },
        );
      }}
    >
      <h2 className="m-0 text-[18px] font-extrabold">Nuevo correo</h2>
      <Input aria-label="Para" type="email" required maxLength={254} placeholder="Para" value={to} onChange={(e) => setTo(e.target.value)} />
      <Input aria-label="Asunto" required maxLength={160} placeholder="Asunto" value={subject} onChange={(e) => setSubject(e.target.value)} />
      <Textarea aria-label="Mensaje" required rows={8} maxLength={20000} value={body} onChange={(e) => setBody(e.target.value)} />
      {error ? <p className="m-0 rounded-xl bg-danger-soft p-2 text-sm text-danger" role="alert">{error}</p> : null}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" disabled={busy || !to || !subject.trim() || !body.trim()}>
          Enviar
        </Button>
      </div>
    </form>
  );
}

/** Gmail-like inbox for contacto@vendemas.chat (ADR 0020): folders, list and thread panes. */
export function EmailInbox() {
  const [folder, setFolder] = useState<SupportEmailFolder>("inbox");
  const [selected, setSelected] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const state = useAsync(() => platformEmailApi.list(folder), [folder]);
  const canned = useAsync(() => platformSupportApi.canned(), []);
  const reloadRef = useRef(state.reload);
  reloadRef.current = state.reload;
  useEffect(() => {
    const onChange = () => reloadRef.current();
    window.addEventListener(SUPPORT_CHANGED, onChange);
    window.addEventListener(EMAIL_READ, onChange);
    return () => {
      window.removeEventListener(SUPPORT_CHANGED, onChange);
      window.removeEventListener(EMAIL_READ, onChange);
    };
  }, []);
  const items = state.data?.items ?? [];
  const showDetail = selected !== null || composing;

  return (
    <>
      <PageHeader title="Correo" subtitle="contacto@vendemas.chat · los correos entrantes se convierten en tickets." />
      <div className="grid gap-4 desk:grid-cols-[200px_minmax(280px,380px)_1fr]">
        <nav aria-label="Carpetas" className={cn("flex flex-col gap-1 rounded-[16px] bg-white p-2", showDetail ? "hidden desk:flex" : "")}>
          <Button
            size="sm"
            className="mb-2"
            onClick={() => {
              setSelected(null);
              setComposing(true);
            }}
          >
            <PenSquare size={14} aria-hidden /> Redactar
          </Button>
          {SUPPORT_EMAIL_FOLDERS.map((f) => {
            const Icon = FOLDER_ICONS[f];
            return (
              <button
                key={f}
                type="button"
                aria-current={f === folder ? "page" : undefined}
                onClick={() => {
                  setFolder(f);
                  setSelected(null);
                  setComposing(false);
                }}
                className={cn("flex cursor-pointer items-center gap-2 rounded-xl border-0 px-3 py-2 text-left text-[13px]", f === folder ? "bg-royal-soft font-bold text-ink" : "bg-transparent text-ink hover:bg-paper")}
              >
                <Icon size={15} aria-hidden /> {EMAIL_FOLDER_LABELS[f]}
              </button>
            );
          })}
        </nav>
        <div className={cn("rounded-[16px] bg-white p-2", showDetail ? "hidden desk:block" : "")}>
          <Loading state={state}>
            {items.length === 0 ? (
              <p className="m-0 flex items-center gap-2 p-3 text-sm text-muted">
                <Mail size={16} aria-hidden /> No hay correos en esta carpeta.
              </p>
            ) : (
              <ul className="m-0 flex list-none flex-col gap-0.5 p-0" aria-label="Correos">
                {items.map((t) => (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setComposing(false);
                        setSelected(t.id);
                      }}
                      aria-current={t.id === selected ? "true" : undefined}
                      className={cn("flex w-full cursor-pointer flex-col gap-0.5 rounded-xl border-0 px-3 py-2 text-left", t.id === selected ? "bg-royal-soft" : "bg-transparent hover:bg-paper")}
                    >
                      <span className="flex items-center gap-2">
                        <span className={cn("min-w-0 flex-1 truncate text-[13px] text-ink", t.unread ? "font-extrabold" : "font-medium")}>{t.contactName ?? t.contactEmail ?? "—"}</span>
                        <span className="flex-none text-[11px] text-muted">{formatDateTime(t.lastMessageAt)}</span>
                      </span>
                      <span className={cn("truncate text-[13px] text-ink", t.unread ? "font-bold" : "")}>{t.subject}</span>
                      <span className="flex items-center gap-1.5 text-[12px] text-muted">
                        <SupportStatusPill status={t.status} />
                        <span className="min-w-0 truncate">{t.snippet}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Loading>
        </div>
        <div className={cn("rounded-[16px] bg-white p-4", showDetail ? "" : "hidden desk:block")}>
          {showDetail ? (
            <Button
              variant="ghost"
              size="sm"
              className="mb-2 desk:hidden"
              onClick={() => {
                setSelected(null);
                setComposing(false);
              }}
            >
              ← Volver
            </Button>
          ) : null}
          {composing ? (
            <ComposeForm
              onCancel={() => setComposing(false)}
              onSent={(id) => {
                setComposing(false);
                setFolder("sent");
                setSelected(id);
              }}
            />
          ) : selected ? (
            <ThreadView id={selected} canned={canned.data?.items ?? []} onChanged={state.reload} />
          ) : (
            <p className="m-0 text-sm text-muted">Elige un correo para leer la conversación.</p>
          )}
        </div>
      </div>
    </>
  );
}
