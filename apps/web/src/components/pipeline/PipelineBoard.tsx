"use client";

import type { Opportunity, Pipeline, Stage } from "@crmwsp/contracts";
import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, PageHeader } from "@/components/app/EmptyState";
import { useSession } from "@/components/app/SessionProvider";
import { QUOTE_STATUS_LABELS, QUOTE_STATUS_TONES } from "@/components/quotes/quote-meta";
import { Alert, Button, ReasonDialog, StatusChip, Toast } from "@/components/ui";
import { formatMoneyMinor } from "@/lib/format";
import { useToast } from "@/lib/hooks/use-toast";
import { errorMessage } from "@/lib/messages";
import { pipelineApi } from "@/lib/pipeline-api";
import { canMoveOpportunities, columnTotal, groupByStage } from "./pipeline-meta";

const MAX_PAGES = 5;

export function PipelineBoard() {
  const { tenant } = useSession();
  const canMove = canMoveOpportunities(tenant?.role);
  const [pipeline, setPipeline] = useState<Pipeline | null>(null);
  const [items, setItems] = useState<Opportunity[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [lostFor, setLostFor] = useState<{ opp: Opportunity; stage: Stage } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const { message, show } = useToast();

  const load = useCallback(async () => {
    try {
      const list = await pipelineApi.pipelines();
      const p = list.items.find((x) => x.isDefault) ?? list.items[0] ?? null;
      setPipeline(p);
      if (!p) {
        setItems([]);
        return;
      }
      const all: Opportunity[] = [];
      let cursor: string | undefined;
      let pages = 0;
      do {
        const page = await pipelineApi.opportunities({ pipelineId: p.id, cursor });
        all.push(...page.items);
        cursor = page.nextCursor ?? undefined;
        pages += 1;
      } while (cursor && pages < MAX_PAGES);
      setTruncated(Boolean(cursor));
      setItems(all);
      setError(null);
    } catch (err) {
      setError(err);
      setItems((cur) => cur ?? []);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const stages = useMemo(() => [...(pipeline?.stages ?? [])].sort((a, b) => a.position - b.position), [pipeline]);
  const grouped = useMemo(() => groupByStage(stages, items ?? []), [stages, items]);

  async function move(opp: Opportunity, stage: Stage, lostReason?: string) {
    if (!canMove || opp.stageId === stage.id) return;
    if (stage.kind === "lost" && !lostReason) {
      setLostFor({ opp, stage });
      return;
    }
    setBusyId(opp.id);
    try {
      const updated = await pipelineApi.move(opp.id, { stageId: stage.id, lockVersion: opp.lockVersion, ...(lostReason ? { lostReason } : {}) });
      setItems((list) => (list ?? []).map((o) => (o.id === updated.id ? updated : o)));
      setError(null);
      show(`Movida a ${stage.name}`);
    } catch (err) {
      setError(err);
      void load();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <PageHeader title="Pipeline" subtitle="Tus oportunidades por etapa, desde el primer contacto hasta el cierre." />
      {error ? <div className="mb-4"><Alert>{errorMessage(error)}</Alert></div> : null}
      {truncated ? <div className="mb-4"><Alert>Se muestran las {items?.length} oportunidades más recientes.</Alert></div> : null}

      {items === null ? (
        <p className="text-muted" aria-busy="true">Cargando pipeline…</p>
      ) : !pipeline || stages.length === 0 ? (
        <EmptyState title="Sin pipeline">Tu espacio aún no tiene etapas configuradas.</EmptyState>
      ) : (
        <div className="no-scrollbar flex gap-3 overflow-x-auto pb-2">
          {stages.map((stage) => {
            const col = grouped.get(stage.id) ?? [];
            const total = columnTotal(col);
            return (
              <section
                key={stage.id}
                aria-label={stage.name}
                onDragOver={(e) => canMove && dragId && e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const opp = items.find((o) => o.id === dragId);
                  setDragId(null);
                  if (opp) void move(opp, stage);
                }}
                className="flex w-[270px] flex-none flex-col gap-2 rounded-[18px] bg-paper p-3"
              >
                <h2 className="m-0 flex items-center justify-between text-sm font-extrabold">
                  {stage.name}
                  <span className="text-muted">{col.length}</span>
                </h2>
                {total ? <p className="m-0 text-xs text-muted">{formatMoneyMinor(total.minor, total.currency)}</p> : null}
                {col.length === 0 ? <p className="m-0 text-sm text-muted">Sin oportunidades</p> : null}
                {col.map((o) => (
                  <article
                    key={o.id}
                    draggable={canMove && busyId !== o.id}
                    onDragStart={() => setDragId(o.id)}
                    onDragEnd={() => setDragId(null)}
                    aria-busy={busyId === o.id}
                    className={`flex flex-col gap-1 rounded-2xl border border-line bg-white p-3 ${canMove ? "cursor-grab" : ""} ${busyId === o.id ? "opacity-60" : ""}`}
                  >
                    <b className="truncate">{o.title}</b>
                    <span className="truncate text-sm">{o.contact.name?.trim() || o.contact.phoneE164}</span>
                    {o.valueMinor !== null ? <span className="text-sm text-muted">{formatMoneyMinor(o.valueMinor, o.currency)}</span> : null}
                    {o.lastQuote ? (
                      <span className="flex items-center gap-1.5 text-xs text-muted">
                        {o.lastQuote.number}
                        <StatusChip label={QUOTE_STATUS_LABELS[o.lastQuote.status]} tone={QUOTE_STATUS_TONES[o.lastQuote.status]} />
                      </span>
                    ) : null}
                    {canMove ? (
                      <label className="mt-1 block text-xs text-muted">
                        <span className="sr-only">Mover {o.title} a</span>
                        <select
                          className="h-9 w-full rounded-xl border border-line bg-white px-2 text-sm text-ink"
                          value={o.stageId}
                          disabled={busyId === o.id}
                          onChange={(e) => {
                            const target = stages.find((s) => s.id === e.target.value);
                            if (target) void move(o, target);
                          }}
                        >
                          {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </select>
                      </label>
                    ) : null}
                  </article>
                ))}
              </section>
            );
          })}
        </div>
      )}

      {lostFor ? (
        <ReasonDialog
          title="Marcar como perdida"
          description={`"${lostFor.opp.title}" pasará a ${lostFor.stage.name}.`}
          fieldLabel="Motivo (obligatorio)"
          confirmLabel="Marcar perdida"
          onCancel={() => setLostFor(null)}
          onConfirm={(reason) => {
            const { opp, stage } = lostFor;
            setLostFor(null);
            void move(opp, stage, reason);
          }}
        />
      ) : null}
      <Toast message={message} />
      {error ? <Button variant="outline" onClick={() => void load()}>Reintentar</Button> : null}
    </>
  );
}
