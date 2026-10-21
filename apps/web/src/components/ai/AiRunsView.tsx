"use client";

import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AI_RUN_MODES, AI_RUN_OUTCOMES, type AiRunItem, type AiRunMode, type AiRunOutcome, type AiRunsSummary, type PlaybookSummaryRow } from "@crmwsp/contracts";
import { EmptyState, PageHeader } from "@/components/app/EmptyState";
import { canManageAi, canViewAi } from "@/components/app/roles";
import { useSession } from "@/components/app/SessionProvider";
import { Alert, Button, Card, Chip, StatusChip } from "@/components/ui";
import { MODE_LABELS, OUTCOME_LABELS, OUTCOME_TONES, reasonLabel } from "@/lib/ai-runs";
import { aiRunsApi } from "@/lib/ai-runs-api";
import { STAGE_LABELS, objectionLabel, share } from "@/lib/playbook";
import { playbookApi } from "@/lib/playbook-api";
import { formatDateTime } from "@/lib/format";
import { errorMessage } from "@/lib/messages";
import { AiSectionTabs } from "./AiSectionTabs";

function RunDetail({ run }: { run: AiRunItem }) {
  return (
    <div className="flex flex-col gap-3 border-t border-line bg-paper-2 px-4 py-3 text-[13px]">
      {run.text ? <p className="m-0 whitespace-pre-wrap">{run.text}</p> : null}
      <p className="m-0">
        <b>Motivo: </b>
        {reasonLabel(run.reason)}
        {run.confidence !== null ? (
          <>
            {" · "}
            <b>Confianza: </b>
            {Math.round(run.confidence * 100)} %
          </>
        ) : null}
      </p>
      {run.salesStage ? (
        <p className="m-0">
          <b>Etapa de venta: </b>
          {STAGE_LABELS[run.salesStage]}
          {run.objection ? (
            <>
              {" · "}
              <b>Objeción: </b>
              {objectionLabel(run.objection)}
            </>
          ) : null}
        </p>
      ) : null}
      <div>
        <b>Fuentes citadas</b>
        {run.citations.length === 0 ? (
          <p className="mt-1 mb-0 text-muted">Esta ejecución no citó fuentes de conocimiento.</p>
        ) : (
          <ul className="mt-1 mb-0 flex list-none flex-col gap-2 p-0">
            {run.citations.map((c) => (
              <li key={c.chunkId} className="rounded-xl border border-line bg-white p-2.5">
                <b>{c.title ?? "Fuente eliminada"}</b>
                {c.excerpt ? <p className="mt-1 mb-0 text-muted">{c.excerpt}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function RunRow({ run }: { run: AiRunItem }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="overflow-hidden rounded-[14px] border border-line bg-white">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
        <button
          type="button"
          aria-expanded={open}
          aria-label={open ? "Ocultar detalle" : "Ver detalle"}
          onClick={() => setOpen((v) => !v)}
          className="grid size-8 flex-none cursor-pointer place-items-center rounded-full border-0 bg-transparent hover:bg-paper"
        >
          <ChevronDown aria-hidden className={open ? "size-4 rotate-180" : "size-4"} />
        </button>
        <span className="min-w-[130px] text-[13px] text-muted">{formatDateTime(run.createdAt)}</span>
        <span className="min-w-0 flex-1 basis-[160px] truncate font-bold">
          {run.conversationId ? (
            <Link href={`/app/inbox?conversation=${run.conversationId}`} className="underline">
              {run.contactName ?? "Conversación"}
            </Link>
          ) : (
            (run.contactName ?? "Conversación eliminada")
          )}
        </span>
        <StatusChip label={OUTCOME_LABELS[run.outcome]} tone={OUTCOME_TONES[run.outcome]} />
        {run.salesStage ? <StatusChip label={run.objection ? `${STAGE_LABELS[run.salesStage]} · ${objectionLabel(run.objection)}` : STAGE_LABELS[run.salesStage]} tone="paper" /> : null}
        <span className="w-[88px] text-[13px]">{run.mode ? MODE_LABELS[run.mode] : "—"}</span>
        <span className="min-w-[90px] text-[13px] text-muted">{run.model ?? "—"}</span>
        <span className="text-[13px] text-muted">
          {run.citations.length} {run.citations.length === 1 ? "fuente" : "fuentes"}
        </span>
      </div>
      {open ? <RunDetail run={run} /> : null}
    </li>
  );
}

function SummaryTable({ title, rows, label }: { title: string; rows: PlaybookSummaryRow[]; label: (key: string) => string }) {
  return (
    <div className="min-w-0 flex-1 basis-[320px]">
      <h3 className="m-0 mb-2 text-[15px]">{title}</h3>
      {rows.length === 0 ? (
        <p className="m-0 text-[13px] text-muted">Aún no hay ejecuciones con esta información.</p>
      ) : (
        <table className="w-full border-collapse text-left text-[13px]">
          <thead>
            <tr className="text-muted">
              <th scope="col" className="py-1 pr-2 font-bold">{title === "Por etapa" ? "Etapa" : "Objeción"}</th>
              <th scope="col" className="py-1 pr-2 font-bold">Ejecuciones</th>
              <th scope="col" className="py-1 pr-2 font-bold">Conversaciones</th>
              <th scope="col" className="py-1 pr-2 font-bold">Presupuesto aceptado</th>
              <th scope="col" className="py-1 font-bold">Pago verificado</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-t border-line">
                <th scope="row" className="py-1.5 pr-2 font-bold">{label(r.key)}</th>
                <td className="py-1.5 pr-2">{r.runs}</td>
                <td className="py-1.5 pr-2">{r.conversations}</td>
                <td className="py-1.5 pr-2">{share(r.quoteAccepted, r.conversations)}</td>
                <td className="py-1.5">{share(r.paidVerified, r.conversations)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/** Read-only outcome attribution of the sales playbook (last 30 days). It never changes any prompt. */
function PlaybookSummary() {
  const [summary, setSummary] = useState<AiRunsSummary | null>(null);
  useEffect(() => {
    let live = true;
    playbookApi
      .summary(30)
      .then((s) => live && setSummary(s))
      .catch(() => undefined); // The summary is optional: the runs list works without it.
    return () => {
      live = false;
    };
  }, []);
  if (!summary || (summary.byStage.length === 0 && summary.byObjection.length === 0)) return null;
  return (
    <Card className="sm:p-5">
      <h2 className="m-0 text-[17px]">Resultados por etapa y objeción</h2>
      <p className="mt-1 mb-3 text-[13px] text-muted">
        Últimos {summary.days} días. Cuenta las conversaciones que después aceptaron un presupuesto o pagaron un pedido verificado (webhook, conciliación o marcado manual auditado). Es solo informativo: no cambia lo que hace la IA.
      </p>
      <div className="flex flex-wrap gap-6">
        <SummaryTable title="Por etapa" rows={summary.byStage} label={(k) => STAGE_LABELS[k as keyof typeof STAGE_LABELS] ?? k} />
        <SummaryTable title="Por objeción" rows={summary.byObjection} label={objectionLabel} />
      </div>
    </Card>
  );
}

function Body({ showSummary }: { showSummary: boolean }) {
  const [outcome, setOutcome] = useState<AiRunOutcome | undefined>();
  const [mode, setMode] = useState<AiRunMode | undefined>();
  const [items, setItems] = useState<AiRunItem[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState<string>();
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(async () => {
    setItems(null);
    setError(undefined);
    try {
      const res = await aiRunsApi.runs({ outcome, mode });
      setItems(res.items);
      setNext(res.nextCursor);
    } catch (err) {
      setError(errorMessage(err));
      setItems([]);
      setNext(null);
    }
  }, [outcome, mode]);
  useEffect(() => {
    void load();
  }, [load]);

  async function more() {
    if (!next) return;
    setLoadingMore(true);
    try {
      const res = await aiRunsApi.runs({ outcome, mode, cursor: next });
      setItems((cur) => [...(cur ?? []), ...res.items]);
      setNext(res.nextCursor);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {showSummary ? <PlaybookSummary /> : null}
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filtros">
        <Chip active={outcome === undefined} onClick={() => setOutcome(undefined)}>
          Todos los resultados
        </Chip>
        {AI_RUN_OUTCOMES.map((o) => (
          <Chip key={o} active={outcome === o} onClick={() => setOutcome(outcome === o ? undefined : o)}>
            {OUTCOME_LABELS[o]}
          </Chip>
        ))}
        <span aria-hidden className="mx-1 h-5 w-px bg-line-2" />
        {AI_RUN_MODES.map((m) => (
          <Chip key={m} active={mode === m} onClick={() => setMode(mode === m ? undefined : m)}>
            {MODE_LABELS[m]}
          </Chip>
        ))}
      </div>
      <Alert>{error}</Alert>
      {items === null ? (
        <p className="text-muted" aria-busy="true">
          Cargando ejecuciones…
        </p>
      ) : items.length === 0 && !error ? (
        <EmptyState title="Sin ejecuciones">
          {outcome || mode ? "Ninguna ejecución coincide con los filtros." : "Cuando la IA responda, deje un borrador o derive una conversación, aparecerá aquí."}
        </EmptyState>
      ) : (
        <Card className="p-0">
          <ul className="m-0 flex list-none flex-col gap-2 p-2">
            {items.map((r) => (
              <RunRow key={r.id} run={r} />
            ))}
          </ul>
        </Card>
      )}
      {next ? (
        <div className="flex justify-center">
          <Button variant="outline" disabled={loadingMore} onClick={() => void more()}>
            {loadingMore ? "Cargando…" : "Cargar más"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function AiRunsView() {
  const { tenant } = useSession();
  return (
    <>
      <PageHeader title="IA" subtitle="Revisa qué respondió la IA en cada conversación y en qué información se apoyó." />
      <AiSectionTabs />
      {canViewAi(tenant?.role) ? <Body showSummary={canManageAi(tenant?.role)} /> : <EmptyState title="Sin acceso">Pide a un propietario o administrador que te dé acceso.</EmptyState>}
    </>
  );
}
