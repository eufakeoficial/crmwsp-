"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { AiHandoffItem } from "@crmwsp/contracts";
import { EmptyState, PageHeader } from "@/components/app/EmptyState";
import { canViewAi } from "@/components/app/roles";
import { useSession } from "@/components/app/SessionProvider";
import { Alert, Button, Card, CHIP_ROW, Chip, Toast } from "@/components/ui";
import { reasonLabel, waitingLabel } from "@/lib/ai-runs";
import { aiRunsApi } from "@/lib/ai-runs-api";
import { formatDateTime } from "@/lib/format";
import { useToast } from "@/lib/hooks/use-toast";
import { inboxV2Api } from "@/lib/inbox-v2-api";
import { errorMessage } from "@/lib/messages";
import { AiSectionTabs } from "./AiSectionTabs";

type Filter = "all" | "unassigned" | "me";

function Body() {
  const [filter, setFilter] = useState<Filter>("all");
  const [items, setItems] = useState<AiHandoffItem[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState<string>();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const { message, show } = useToast();
  const assignedTo = filter === "all" ? undefined : filter;

  const load = useCallback(async () => {
    setItems(null);
    setError(undefined);
    try {
      const res = await aiRunsApi.handoffs({ assignedTo });
      setItems(res.items);
      setNext(res.nextCursor);
    } catch (err) {
      setError(errorMessage(err));
      setItems([]);
      setNext(null);
    }
  }, [assignedTo]);
  useEffect(() => {
    void load();
  }, [load]);

  async function more() {
    if (!next) return;
    setLoadingMore(true);
    try {
      const res = await aiRunsApi.handoffs({ assignedTo, cursor: next });
      setItems((cur) => [...(cur ?? []), ...res.items]);
      setNext(res.nextCursor);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoadingMore(false);
    }
  }

  async function act(item: AiHandoffItem, kind: "assign" | "resolve") {
    setBusyId(item.id);
    setError(undefined);
    try {
      if (kind === "assign") {
        const updated = await inboxV2Api.assign(item.conversationId, "me");
        const assignee = updated.assignee;
        setItems((cur) =>
          (cur ?? [])
            .map((i) => (i.id === item.id ? { ...i, assigneeId: assignee?.id ?? null, assigneeName: assignee?.name ?? assignee?.email ?? null } : i))
            .filter((i) => filter !== "unassigned" || i.id !== item.id),
        );
        show("Conversación asignada a ti");
      } else {
        await inboxV2Api.setStatus(item.conversationId, "closed");
        setItems((cur) => (cur ?? []).filter((i) => i.id !== item.id));
        show("Conversación marcada como resuelta");
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className={CHIP_ROW} role="group" aria-label="Filtros">
        <Chip active={filter === "all"} onClick={() => setFilter("all")}>
          Todas
        </Chip>
        <Chip active={filter === "unassigned"} onClick={() => setFilter("unassigned")}>
          Sin asignar
        </Chip>
        <Chip active={filter === "me"} onClick={() => setFilter("me")}>
          Asignadas a mí
        </Chip>
      </div>
      <Alert>{error}</Alert>
      {items === null ? (
        <p className="text-muted" aria-busy="true">
          Cargando conversaciones…
        </p>
      ) : items.length === 0 && !error ? (
        <EmptyState title="Nada pendiente">Cuando la IA derive una conversación a una persona y nadie la haya respondido, aparecerá aquí.</EmptyState>
      ) : (
        <ul className="m-0 grid list-none grid-cols-1 gap-3 p-0 md:grid-cols-2">
          {items.map((h) => (
            <li key={h.id}>
              <Card className="flex h-full flex-col gap-3 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <b className="block truncate">{h.contactName ?? h.contactPhone}</b>
                    <span className="text-[13px] text-muted">{reasonLabel(h.reason)}</span>
                  </div>
                  <span className="flex-none rounded-full bg-paper px-2.5 py-0.5 text-xs font-extrabold" title={formatDateTime(h.handedOffAt)}>
                    Espera {waitingLabel(h.handedOffAt)}
                  </span>
                </div>
                <p className="m-0 text-[13px] text-muted">{h.assigneeName ? `Asignada a ${h.assigneeName}` : "Sin asignar"}</p>
                <div className="mt-auto flex flex-wrap gap-2">
                  <Link
                    href={`/app/inbox?conversation=${h.conversationId}`}
                    className="inline-flex h-9 items-center rounded-full bg-ink px-4 text-sm font-semibold text-white no-underline hover:bg-ink-2"
                  >
                    Abrir en la bandeja
                  </Link>
                  <Button size="sm" variant="outline" disabled={busyId === h.id} onClick={() => void act(h, "assign")}>
                    Asignarme
                  </Button>
                  <Button size="sm" variant="outline" disabled={busyId === h.id} onClick={() => void act(h, "resolve")}>
                    Marcar resuelta
                  </Button>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
      {next ? (
        <div className="flex justify-center">
          <Button variant="outline" disabled={loadingMore} onClick={() => void more()}>
            {loadingMore ? "Cargando…" : "Cargar más"}
          </Button>
        </div>
      ) : null}
      <Toast message={message} />
    </div>
  );
}

export function AiHandoffsView() {
  const { tenant } = useSession();
  return (
    <>
      <PageHeader title="IA" subtitle="Conversaciones que la IA derivó a una persona y que nadie ha respondido todavía." />
      <AiSectionTabs />
      {canViewAi(tenant?.role) ? <Body /> : <EmptyState title="Sin acceso">Pide a un propietario o administrador que te dé acceso.</EmptyState>}
    </>
  );
}
