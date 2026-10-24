"use client";

import {
  SUPPORT_TICKET_CATEGORIES,
  SUPPORT_TICKET_PRIORITIES,
  SUPPORT_TICKET_STATUSES,
  type PlatformSupportListQuery,
  type PlatformSupportThread,
  type SupportCannedResponse,
  type SupportTicketPriority,
  type SupportTicketStatus,
} from "@crmwsp/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { PageHeader } from "@/components/app/EmptyState";
import { Button, Spinner, Switch, Textarea } from "@/components/ui";
import { cn } from "@/lib/cn";
import { formatDateTime } from "@/lib/format";
import { platformApi, platformErrorMessage } from "@/lib/platform-api";
import { SUPPORT_CATEGORY_LABELS, SUPPORT_CHANGED, SUPPORT_PRIORITY_LABELS, SUPPORT_READ, SUPPORT_STATUS_LABELS, platformSupportApi, renderCannedResponse } from "@/lib/support-api";
import { SupportMessages, SupportPriorityTag, SupportStatusPill } from "@/components/support/SupportParts";
import { Loading, fieldClass, useAsync } from "./shared";

interface Filters {
  status: SupportTicketStatus | "";
  priority: SupportTicketPriority | "";
  category: (typeof SUPPORT_TICKET_CATEGORIES)[number] | "";
  tenantId: string;
  assigned: "" | "me" | "none";
}
const EMPTY: Filters = { status: "", priority: "", category: "", tenantId: "", assigned: "" };

function toQuery(f: Filters): PlatformSupportListQuery {
  return {
    ...(f.status ? { status: f.status } : {}),
    ...(f.priority ? { priority: f.priority } : {}),
    ...(f.category ? { category: f.category } : {}),
    ...(f.tenantId ? { tenantId: f.tenantId } : {}),
    ...(f.assigned ? { assigned: f.assigned } : {}),
  };
}

function ThreadPanel({ id, canned, onChanged }: { id: string; canned: readonly SupportCannedResponse[]; onChanged: () => void }) {
  const [thread, setThread] = useState<PlatformSupportThread | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [internal, setInternal] = useState(false);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    platformSupportApi.thread(id).then(
      (t) => {
        setThread(t);
        setError(null);
        window.dispatchEvent(new Event(SUPPORT_READ));
      },
      (err: unknown) => setError(platformErrorMessage(err)),
    );
  }, [id]);
  useEffect(() => {
    setThread(null);
    setReply("");
    setInternal(false);
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

  if (error && !thread) return <p className="rounded-xl bg-danger-soft p-3 text-sm text-danger" role="alert">{error}</p>;
  if (!thread) {
    return (
      <div className="flex justify-center py-10" aria-busy="true">
        <Spinner />
      </div>
    );
  }
  const t = thread.ticket;
  const insertCanned = (cannedId: string) => {
    const c = canned.find((x) => x.id === cannedId);
    if (!c) return;
    const text = renderCannedResponse(c.body, {
      nombre: t.createdBy.name ?? "",
      negocio: t.tenant.name,
      ticket: String(t.number),
      asunto: t.subject,
    });
    setReply((r) => (r.trim() ? `${r}\n\n${text}` : text));
  };
  const update = (body: Parameters<typeof platformSupportApi.update>[1]) =>
    run(async () => {
      const ticket = await platformSupportApi.update(t.id, body);
      setThread((th) => (th ? { ...th, ticket } : th));
    });

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h2 className="m-0 text-[18px] font-extrabold">
          #{t.number} · {t.subject}
        </h2>
        <p className="m-0 mt-1 text-[12px] text-muted">
          {t.tenant.name} · {t.createdBy.name ?? "—"} {t.createdBy.email ? `(${t.createdBy.email})` : ""} · {SUPPORT_CATEGORY_LABELS[t.category]} · {formatDateTime(t.createdAt)}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="Estado" className={fieldClass} value={t.status} disabled={busy} onChange={(e) => update({ status: e.target.value as SupportTicketStatus })}>
          {SUPPORT_TICKET_STATUSES.map((s) => (
            <option key={s} value={s}>
              {SUPPORT_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        <select aria-label="Prioridad" className={fieldClass} value={t.priority} disabled={busy} onChange={(e) => update({ priority: e.target.value as SupportTicketPriority })}>
          {SUPPORT_TICKET_PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {SUPPORT_PRIORITY_LABELS[p]}
            </option>
          ))}
        </select>
        {t.assignee ? (
          <>
            <span className="text-[12px] text-muted">Asignado a {t.assignee.name ?? "un admin"}</span>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => update({ assignToMe: false })}>
              Quitar
            </Button>
          </>
        ) : null}
        <Button size="sm" variant="outline" disabled={busy} onClick={() => update({ assignToMe: true })}>
          Asignarme
        </Button>
      </div>
      <div className="max-h-[52vh] overflow-y-auto pr-1">
        <SupportMessages messages={thread.messages} viewer="admin" />
      </div>
      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!reply.trim()) return;
          void run(async () => {
            setThread(await platformSupportApi.reply(t.id, { body: reply, internal }));
            setReply("");
          });
        }}
      >
        <div className="flex flex-wrap items-center gap-2">
          <select aria-label="Insertar respuesta rápida" className={cn(fieldClass, "min-w-0 flex-1 sm:max-w-[260px]")} value="" onChange={(e) => insertCanned(e.target.value)}>
            <option value="">Insertar respuesta rápida…</option>
            {canned.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-2 text-[13px] font-semibold">
            <Switch checked={internal} onChange={setInternal} label="Nota interna" />
            Nota interna (el cliente no la ve)
          </label>
        </div>
        <Textarea aria-label="Respuesta" rows={4} maxLength={5000} value={reply} onChange={(e) => setReply(e.target.value)} className={internal ? "bg-amber-soft" : ""} placeholder={internal ? "Nota para el equipo" : "Respuesta al cliente"} />
        {error ? <p className="m-0 rounded-xl bg-danger-soft p-2 text-sm text-danger" role="alert">{error}</p> : null}
        <div className="flex justify-end">
          <Button type="submit" disabled={busy || !reply.trim()}>
            {internal ? "Guardar nota" : "Responder"}
          </Button>
        </div>
      </form>
    </div>
  );
}

/** Backoffice support inbox: tickets of every tenant with filters, thread and real-time replies. */
export function SupportInbox() {
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [selected, setSelected] = useState<string | null>(null);
  const state = useAsync(() => platformSupportApi.list(toQuery(filters)), [filters]);
  const tenants = useAsync(() => platformApi.tenants(), []);
  const canned = useAsync(() => platformSupportApi.canned(), []);
  const { reload } = state;
  // `reload` changes identity on every render: listen once and call the latest one.
  const reloadRef = useRef(reload);
  reloadRef.current = reload;
  useEffect(() => {
    const onChange = () => reloadRef.current();
    window.addEventListener(SUPPORT_CHANGED, onChange);
    window.addEventListener(SUPPORT_READ, onChange);
    return () => {
      window.removeEventListener(SUPPORT_CHANGED, onChange);
      window.removeEventListener(SUPPORT_READ, onChange);
    };
  }, []);
  const set = <K extends keyof Filters>(k: K) => (e: { target: { value: string } }) => setFilters((f) => ({ ...f, [k]: e.target.value as Filters[K] }));
  const items = state.data?.items ?? [];

  return (
    <>
      <PageHeader title="Tickets de soporte" subtitle="Consultas de todas las empresas. Las respuestas llegan al cliente en tiempo real." />
      <div className="mb-3 flex flex-wrap gap-2">
        <select aria-label="Estado" value={filters.status} onChange={set("status")} className={fieldClass}>
          <option value="">Todos los estados</option>
          {SUPPORT_TICKET_STATUSES.map((s) => (
            <option key={s} value={s}>
              {SUPPORT_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        <select aria-label="Prioridad" value={filters.priority} onChange={set("priority")} className={fieldClass}>
          <option value="">Todas las prioridades</option>
          {SUPPORT_TICKET_PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {SUPPORT_PRIORITY_LABELS[p]}
            </option>
          ))}
        </select>
        <select aria-label="Categoría" value={filters.category} onChange={set("category")} className={fieldClass}>
          <option value="">Todas las categorías</option>
          {SUPPORT_TICKET_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {SUPPORT_CATEGORY_LABELS[c]}
            </option>
          ))}
        </select>
        <select aria-label="Empresa" value={filters.tenantId} onChange={set("tenantId")} className={cn(fieldClass, "max-w-[220px]")}>
          <option value="">Todas las empresas</option>
          {(tenants.data?.items ?? []).map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <select aria-label="Asignación" value={filters.assigned} onChange={set("assigned")} className={fieldClass}>
          <option value="">Cualquier asignación</option>
          <option value="me">Asignados a mí</option>
          <option value="none">Sin asignar</option>
        </select>
      </div>
      <div className="grid gap-4 desk:grid-cols-[minmax(300px,400px)_1fr]">
        <div className={cn("rounded-[16px] bg-white p-2", selected ? "hidden desk:block" : "")}>
          <Loading state={state}>
            {items.length === 0 ? (
              <p className="m-0 p-3 text-sm text-muted">No hay tickets con estos filtros.</p>
            ) : (
              <ul className="m-0 flex list-none flex-col gap-0.5 p-0" aria-label="Tickets">
                {items.map((t) => (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => setSelected(t.id)}
                      aria-current={t.id === selected ? "true" : undefined}
                      className={cn("flex w-full cursor-pointer flex-col gap-1 rounded-xl border-0 px-3 py-2 text-left", t.id === selected ? "bg-royal-soft" : "bg-transparent hover:bg-paper")}
                    >
                      <span className="flex items-center gap-2">
                        <span className={cn("min-w-0 flex-1 truncate text-[13px] text-ink", t.adminUnread ? "font-extrabold" : "font-semibold")}>
                          #{t.number} · {t.subject}
                        </span>
                        {t.adminUnread ? <span className="size-2.5 flex-none rounded-full bg-alert" aria-label="Sin leer" /> : null}
                      </span>
                      <span className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
                        <SupportStatusPill status={t.status} />
                        <SupportPriorityTag priority={t.priority} />
                        <span className="truncate">{t.tenant.name}</span>
                        <span>· {formatDateTime(t.lastMessageAt)}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Loading>
        </div>
        <div className={cn("rounded-[16px] bg-white p-4", selected ? "" : "hidden desk:block")}>
          {selected ? (
            <>
              <Button variant="ghost" size="sm" className="mb-2 desk:hidden" onClick={() => setSelected(null)}>
                ← Volver
              </Button>
              <ThreadPanel id={selected} canned={canned.data?.items ?? []} onChanged={reload} />
            </>
          ) : (
            <p className="m-0 text-sm text-muted">Elige un ticket para ver la conversación.</p>
          )}
        </div>
      </div>
    </>
  );
}
