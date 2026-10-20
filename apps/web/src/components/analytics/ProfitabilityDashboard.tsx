"use client";

import type { Profitability, ProfitabilityGroupBy, ProfitabilityRow } from "@crmwsp/contracts";
import { CircleDollarSign, MessageCircle, Megaphone, Sparkles, Trophy, TrendingUp } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/app/EmptyState";
import { BarChart } from "@/components/app/dashboard/BarChart";
import { RANGE_OPTIONS, formatBp, rangeFor, type RangeDays } from "@/components/app/dashboard/dashboard-utils";
import { Alert, Card, Chip, DataCell, DataRow, DataTable, KpiCard, Spinner } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { analyticsApi } from "@/lib/analytics-api";
import { formatMoneyMinor, formatNumber } from "@/lib/format";

const GROUPS: { key: ProfitabilityGroupBy; label: string }[] = [
  { key: "customer", label: "Por cliente" },
  { key: "order", label: "Por venta" },
  { key: "ad", label: "Por anuncio" },
];
const EST = "estimado";
const GRID = "minmax(160px,2fr) repeat(6, minmax(90px,1fr))";

function Est() {
  return <span className="ml-1 rounded bg-paper-2 px-1 text-[10px] font-bold uppercase text-muted">{EST}</span>;
}

export function ProfitabilityDashboard() {
  const [days, setDays] = useState<RangeDays>(30);
  const [groupBy, setGroupBy] = useState<ProfitabilityGroupBy>("customer");
  const [currency, setCurrency] = useState<string | undefined>(undefined);
  const [data, setData] = useState<Profitability | null>(null);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async (d: RangeDays, g: ProfitabilityGroupBy, c: string | undefined) => {
    try {
      setData(await analyticsApi.profitability({ ...rangeFor(d), groupBy: g, ...(c ? { currency: c } : {}) }));
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, []);
  useEffect(() => {
    void load(days, groupBy, currency);
  }, [load, days, groupBy, currency]);

  const cur = data?.currency ?? "USD";
  const usd = data?.usageCostCurrency ?? "USD";
  const money = (v: number) => formatMoneyMinor(v, cur);
  const usage = (v: number) => formatMoneyMinor(v, usd);
  const t = data?.totals;
  const forbidden = error instanceof ApiError && error.status === 403;

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader title="Rentabilidad" subtitle="Ingresos verificados frente a lo que cuesta cada cliente, venta o anuncio." />
        <div className="flex flex-wrap gap-2">
          <div role="group" aria-label="Rango de fechas" className="flex gap-2">
            {RANGE_OPTIONS.map((d) => (
              <Chip key={d} active={d === days} onClick={() => setDays(d)}>
                {d} días
              </Chip>
            ))}
          </div>
          {data && data.currencies.length > 1 ? (
            <div role="group" aria-label="Moneda" className="flex gap-2">
              {data.currencies.map((c) => (
                <Chip key={c} active={c === cur} onClick={() => setCurrency(c)}>
                  {c}
                </Chip>
              ))}
            </div>
          ) : null}
        </div>
      </div>
      <Alert>{error ? (forbidden ? "Solo propietarios y administradores ven la rentabilidad." : "No pudimos cargar la rentabilidad. Inténtalo de nuevo.") : null}</Alert>
      {!data && !error ? <Spinner /> : null}
      {data && t ? (
        <div className="grid gap-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard label="Ingresos verificados" value={money(t.revenueMinor)} icon={CircleDollarSign} note="solo pagos confirmados por el proveedor" />
            <KpiCard
              label="Margen"
              value={money(t.marginMinor)}
              icon={TrendingUp}
              note={<>{data.usageCostsInMargin ? "ingresos − anuncios − uso" : `ingresos − anuncios (uso en ${usd}, sin conversión)`}<Est /></>}
            />
            <KpiCard label="Coste por conversación" value={t.costPerConversationMinor === null ? "-" : usage(t.costPerConversationMinor)} icon={MessageCircle} note={<>{formatNumber(t.conversations)} conversaciones con coste<Est /></>} />
            <KpiCard label="Coste por presupuesto ganado" value={t.costPerWonQuoteMinor === null ? "-" : money(t.costPerWonQuoteMinor)} icon={Trophy} note={<>{formatNumber(t.wonQuotes)} aceptados<Est /></>} />
            <KpiCard label="Gasto en anuncios" value={money(t.adSpendMinor)} icon={Megaphone} note={<>repartido por primer anuncio<Est /></>} />
            <KpiCard label="IA (tokens)" value={usage(t.aiCostMinor)} icon={Sparkles} />
            <KpiCard label="Voz (TTS)" value={usage(t.ttsCostMinor)} icon={Sparkles} note={<>tarifa por carácter<Est /></>} />
            <KpiCard
              label="WhatsApp (plantillas)"
              value={usage(t.whatsappCostMinor)}
              icon={MessageCircle}
              note={<>{data.whatsappRatesSource === "tenant" ? "tarifas del negocio" : "tarifas por defecto"}<Est /></>}
            />
          </div>

          <Card>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-extrabold">Margen {GROUPS.find((g) => g.key === groupBy)?.label.toLowerCase()}<Est /></h2>
              <div role="group" aria-label="Agrupar" className="flex gap-2">
                {GROUPS.map((g) => (
                  <Chip key={g.key} active={g.key === groupBy} onClick={() => setGroupBy(g.key)}>
                    {g.label}
                  </Chip>
                ))}
              </div>
            </div>
            <BarChart title="Margen por fila" points={data.rows.slice(0, 30).map((r) => ({ label: r.label, value: Math.max(0, r.marginMinor) }))} format={money} />
          </Card>

          <RowsTable rows={data.rows} groupBy={groupBy} money={money} usage={usage} />

          <div className="grid gap-4 lg:grid-cols-2">
            <RankCard title="Clientes más rentables" rows={data.topCustomers} money={money} />
            <RankCard title="Clientes menos rentables" rows={data.bottomCustomers} money={money} />
          </div>

          <Card>
            <h2 className="mb-2 text-base font-extrabold">Conversaciones con coste que nunca compraron<Est /></h2>
            {data.unconverted.length === 0 ? (
              <p className="text-sm text-muted">Ninguna en este periodo.</p>
            ) : (
              <ul className="grid gap-1 text-sm">
                {data.unconverted.slice(0, 20).map((u) => (
                  <li key={u.contactId} className="flex justify-between gap-3">
                    <span className="truncate">{u.label}</span>
                    <span className="tabular-nums text-muted">
                      {formatNumber(u.conversations)} conv. · {usage(u.usageCostMinor)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      ) : null}
    </>
  );
}

function RowsTable({
  rows,
  groupBy,
  money,
  usage,
}: {
  rows: ProfitabilityRow[];
  groupBy: ProfitabilityGroupBy;
  money: (v: number) => string;
  usage: (v: number) => string;
}) {
  const head = groupBy === "ad" ? "Anuncio" : groupBy === "order" ? "Venta" : "Cliente";
  return (
    <DataTable
      label="Rentabilidad"
      grid={GRID}
      minWidth={860}
      columns={[head, "Ingresos", <>Anuncios<Est /></>, "IA", <>Voz<Est /></>, <>WhatsApp<Est /></>, groupBy === "ad" ? "ROAS" : <>Margen<Est /></>]}
      empty={rows.length === 0 ? <p className="px-2 py-4 text-sm text-muted">Sin datos en este periodo.</p> : null}
    >
      {rows.map((r) => (
        <DataRow key={r.key} grid={GRID}>
          <DataCell className="truncate font-semibold">{r.label}</DataCell>
          <DataCell className="tabular-nums">{money(r.revenueMinor)}</DataCell>
          <DataCell className="tabular-nums">{money(r.adSpendMinor)}</DataCell>
          <DataCell className="tabular-nums">{usage(r.aiCostMinor)}</DataCell>
          <DataCell className="tabular-nums">{usage(r.ttsCostMinor)}</DataCell>
          <DataCell className="tabular-nums">{usage(r.whatsappCostMinor)}</DataCell>
          <DataCell className={r.marginMinor < 0 && groupBy !== "ad" ? "tabular-nums text-red-600" : "tabular-nums"}>
            {groupBy === "ad" ? formatBp(r.roasBp) : money(r.marginMinor)}
          </DataCell>
        </DataRow>
      ))}
    </DataTable>
  );
}

function RankCard({ title, rows, money }: { title: string; rows: ProfitabilityRow[]; money: (v: number) => string }) {
  return (
    <Card>
      <h2 className="mb-2 text-base font-extrabold">{title}<Est /></h2>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">Sin datos.</p>
      ) : (
        <ol className="grid gap-1 text-sm">
          {rows.map((r) => (
            <li key={r.key} className="flex justify-between gap-3">
              <span className="truncate">{r.label}</span>
              <span className="tabular-nums">{money(r.marginMinor)}</span>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
