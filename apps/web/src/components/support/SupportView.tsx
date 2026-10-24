"use client";

import {
  SUPPORT_TICKET_CATEGORIES,
  SUPPORT_TICKET_PRIORITIES,
  type SupportTicket,
  type SupportTicketCategory,
  type SupportTicketPriority,
  type SupportTicketThread,
} from "@crmwsp/contracts";
import { Plus } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { EmptyState, PageHeader } from "@/components/app/EmptyState";
import { Alert, Button, Card, Input, Label, Modal, Spinner, Textarea } from "@/components/ui";
import { cn } from "@/lib/cn";
import { formatDateTime } from "@/lib/format";
import { errorMessage } from "@/lib/messages";
import { SUPPORT_CATEGORY_LABELS, SUPPORT_CHANGED, SUPPORT_PRIORITY_LABELS, SUPPORT_READ, supportApi } from "@/lib/support-api";
import { SupportMessages, SupportPriorityTag, SupportStatusPill } from "./SupportParts";

const selectClass = "block h-12 w-full rounded-[14px] border-[1.5px] border-ink bg-white px-3 text-[16px] text-ink";

function NewTicketModal({ onClose, onCreated }: { onClose: () => void; onCreated: (t: SupportTicketThread) => void }) {
  const [subject, setSubject] = useState("");
  const [category, setCategory] = useState<SupportTicketCategory>("other");
  const [priority, setPriority] = useState<SupportTicketPriority>("normal");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = subject.trim().length >= 3 && message.trim().length > 0;
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      onCreated(await supportApi.create({ subject, category, priority, message }));
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };
  return (
    <Modal
      title="Nuevo ticket de soporte"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={!valid || busy}>
            {busy ? "Enviando…" : "Enviar"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div>
          <Label htmlFor="support-subject">Asunto</Label>
          <Input id="support-subject" maxLength={160} value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Ej.: no me llegan los mensajes" />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="support-category">Categoría</Label>
            <select id="support-category" className={selectClass} value={category} onChange={(e) => setCategory(e.target.value as SupportTicketCategory)}>
              {SUPPORT_TICKET_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {SUPPORT_CATEGORY_LABELS[c]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="support-priority">Prioridad</Label>
            <select id="support-priority" className={selectClass} value={priority} onChange={(e) => setPriority(e.target.value as SupportTicketPriority)}>
              {SUPPORT_TICKET_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {SUPPORT_PRIORITY_LABELS[p]}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <Label htmlFor="support-message">Mensaje</Label>
          <Textarea id="support-message" rows={5} maxLength={5000} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Cuéntanos qué pasa y desde cuándo." />
        </div>
        <Alert>{error}</Alert>
      </div>
    </Modal>
  );
}

function TicketRow({ t, active, onOpen }: { t: SupportTicket; active: boolean; onOpen: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        aria-current={active ? "true" : undefined}
        className={cn("flex w-full cursor-pointer flex-col gap-1 rounded-[14px] border-0 px-3 py-2.5 text-left", active ? "bg-royal-soft" : "bg-transparent hover:bg-paper")}
      >
        <span className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-[14px] font-bold text-ink">
            #{t.number} · {t.subject}
          </span>
          {t.unread ? <span className="size-2.5 flex-none rounded-full bg-alert" aria-label="Respuesta sin leer" /> : null}
        </span>
        <span className="flex flex-wrap items-center gap-1.5 text-[12px] text-muted">
          <SupportStatusPill status={t.status} />
          <span>{SUPPORT_CATEGORY_LABELS[t.category]}</span>
          <span>· {formatDateTime(t.lastMessageAt)}</span>
        </span>
      </button>
    </li>
  );
}

function Thread({ id, onChanged }: { id: string; onChanged: () => void }) {
  const [thread, setThread] = useState<SupportTicketThread | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    supportApi.thread(id).then(
      (t) => {
        setThread(t);
        setError(null);
        window.dispatchEvent(new Event(SUPPORT_READ));
      },
      (err: unknown) => setError(errorMessage(err)),
    );
  }, [id]);
  useEffect(() => {
    setThread(null);
    load();
  }, [load]);
  useEffect(() => {
    const onEvent = (e: Event) => {
      if ((e as CustomEvent<string>).detail === id) load();
    };
    window.addEventListener(SUPPORT_CHANGED, onEvent);
    return () => window.removeEventListener(SUPPORT_CHANGED, onEvent);
  }, [id, load]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (error && !thread) return <Alert>{error}</Alert>;
  if (!thread) {
    return (
      <div className="flex justify-center py-10" aria-busy="true">
        <Spinner />
      </div>
    );
  }
  const t = thread.ticket;
  return (
    <div className="flex min-h-0 flex-col gap-3">
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="m-0 text-[18px] font-extrabold">
            #{t.number} · {t.subject}
          </h2>
          <p className="m-0 mt-1 flex flex-wrap items-center gap-1.5 text-[12px] text-muted">
            <SupportStatusPill status={t.status} />
            <SupportPriorityTag priority={t.priority} />
            <span>{SUPPORT_CATEGORY_LABELS[t.category]}</span>
            <span>· Abierto por {t.createdBy.name ?? t.createdBy.email ?? "un usuario"}</span>
          </p>
        </div>
        {t.status !== "resolved" ? (
          <Button variant="outline" size="sm" disabled={busy} onClick={() => run(async () => setThread({ ...thread, ticket: await supportApi.close(t.id) }))}>
            Cerrar ticket
          </Button>
        ) : null}
      </div>
      <div className="max-h-[55vh] overflow-y-auto pr-1">
        <SupportMessages messages={thread.messages} viewer="tenant" />
      </div>
      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!reply.trim()) return;
          void run(async () => {
            setThread(await supportApi.reply(t.id, reply));
            setReply("");
          });
        }}
      >
        <Label htmlFor="support-reply" className="sr-only">
          Responder
        </Label>
        <Textarea id="support-reply" rows={3} maxLength={5000} value={reply} onChange={(e) => setReply(e.target.value)} placeholder={t.status === "resolved" ? "Escribe para reabrir el ticket" : "Escribe tu respuesta"} />
        <Alert>{error}</Alert>
        <div className="flex justify-end">
          <Button type="submit" disabled={busy || !reply.trim()}>
            Enviar
          </Button>
        </div>
      </form>
    </div>
  );
}

/** Tenant support: own tickets (owners/admins see the whole team's), thread and replies in real time. */
export function SupportView() {
  const [tickets, setTickets] = useState<SupportTicket[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const load = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      supportApi.list().then(
        (r) => {
          setTickets(r.items);
          setError(null);
        },
        (err: unknown) => setError(errorMessage(err)),
      );
    }, 150);
  }, []);
  useEffect(() => {
    load();
    window.addEventListener(SUPPORT_CHANGED, load);
    window.addEventListener(SUPPORT_READ, load);
    return () => {
      clearTimeout(timer.current);
      window.removeEventListener(SUPPORT_CHANGED, load);
      window.removeEventListener(SUPPORT_READ, load);
    };
  }, [load]);

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader title="Soporte" subtitle="Escríbenos si algo no funciona. Te respondemos aquí mismo." />
        <Button onClick={() => setCreating(true)}>
          <Plus aria-hidden className="size-4" /> Nuevo ticket
        </Button>
      </div>
      <Alert>{error}</Alert>
      {tickets === null && !error ? (
        <div className="flex justify-center py-10" aria-busy="true">
          <Spinner />
        </div>
      ) : tickets && tickets.length === 0 ? (
        <EmptyState title="Aún no tienes tickets">Cuando abras uno, verás aquí las respuestas del equipo de soporte.</EmptyState>
      ) : tickets ? (
        <div className="grid gap-4 desk:grid-cols-[minmax(260px,340px)_1fr]">
          <Card className={cn("p-2 sm:p-2", selected ? "hidden desk:block" : "")}>
            <ul className="m-0 flex list-none flex-col gap-0.5 p-0" aria-label="Tickets">
              {tickets.map((t) => (
                <TicketRow key={t.id} t={t} active={t.id === selected} onOpen={() => setSelected(t.id)} />
              ))}
            </ul>
          </Card>
          <Card className={cn(selected ? "" : "hidden desk:block")}>
            {selected ? (
              <>
                <Button variant="ghost" size="sm" className="mb-2 desk:hidden" onClick={() => setSelected(null)}>
                  ← Volver a los tickets
                </Button>
                <Thread id={selected} onChanged={load} />
              </>
            ) : (
              <p className="m-0 text-sm text-muted">Elige un ticket para ver la conversación.</p>
            )}
          </Card>
        </div>
      ) : null}
      {creating ? (
        <NewTicketModal
          onClose={() => setCreating(false)}
          onCreated={(t) => {
            setCreating(false);
            setSelected(t.ticket.id);
            load();
          }}
        />
      ) : null}
    </>
  );
}
