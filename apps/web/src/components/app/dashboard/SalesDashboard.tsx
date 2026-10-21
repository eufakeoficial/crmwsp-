"use client";

import type { SalesMetrics } from "@crmwsp/contracts";
import { Bot, CircleDollarSign, MessageCircle, Percent, ShoppingBag, Trophy, UserPlus, Users } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/app/EmptyState";
import { Alert, Card, Chip, KpiCard, Spinner } from "@/components/ui";
import { formatDate, formatMoneyMinor, formatNumber } from "@/lib/format";
import { metricsApi } from "@/lib/metrics-api";
import { BarChart } from "./BarChart";
import { RANGE_OPTIONS, dayRevenue, formatBp, rangeFor, type RangeDays } from "./dashboard-utils";

const STATUS_LABEL: Record<string, string> = {
  draft: "Borrador",
  pending_payment: "Pago pendiente",
  paid: "Pagado",
  fulfilled: "Preparado",
  shipped: "Enviado",
  delivered: "Entregado",
  cancelled: "Cancelado",
  refunded: "Reembolsado",
};

export function SalesDashboard() {
  const [days, setDays] = useState<RangeDays>(30);
  const [data, setData] = useState<SalesMetrics | null>(null);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async (d: RangeDays) => {
    try {
      setData(await metricsApi.sales(rangeFor(d)));
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, []);
  useEffect(() => {
    void load(days);
  }, [load, days]);

  const t = data?.totals;
  const currencies = t?.revenue.map((r) => r.currency) ?? [];
  const revenueText = t
    ? t.revenue.length
      ? t.revenue.map((r) => formatMoneyMinor(r.amountMinor, r.currency)).join(" · ")
      : "0"
    : "";

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader title="Inicio" subtitle="El resumen de tu negocio: ventas por WhatsApp y qué hacer a continuación." />
        <div role="group" aria-label="Rango de fechas" className="flex gap-2">
          {RANGE_OPTIONS.map((d) => (
            <Chip
              key={d}
              active={d === days}
              onClick={() => {
                setData(null);
                setDays(d);
              }}
            >
              {d} días
            </Chip>
          ))}
        </div>
      </div>
      <Alert>{error ? "No pudimos cargar las métricas. Inténtalo de nuevo." : null}</Alert>
      {!data && !error ? <Spinner /> : null}
      {data && t ? (
        <div className="grid gap-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard label="Conversaciones nuevas" value={formatNumber(t.newConversations)} icon={MessageCircle} />
            <KpiCard label="Leads nuevos" value={formatNumber(t.newLeads)} icon={UserPlus} />
            <KpiCard label="Compradores" value={formatNumber(t.buyers)} icon={Users} />
            <KpiCard label="Conversión" value={formatBp(t.conversionBp)} icon={Percent} note="compradores / leads" />
            <KpiCard label="Ingresos" value={revenueText} icon={CircleDollarSign} className="sm:col-span-2" />
            <KpiCard
              label="Producto ganador"
              value={data.winningProduct?.name ?? "-"}
              icon={Trophy}
              note={data.winningProduct ? `${formatNumber(data.winningProduct.quantity)} uds.` : undefined}
            />
            <KpiCard
              label="IA / humano"
              value={`${formatNumber(t.aiConversations)} / ${formatNumber(t.humanConversations)}`}
              icon={Bot}
              note="conversaciones nuevas"
            />
          </div>

          <Card className="sm:p-6">
            <h2 className="m-0 mb-2 text-base font-bold">Conversaciones nuevas por día</h2>
            <BarChart
              title="Conversaciones nuevas por día"
              points={data.daily.map((d) => ({ label: formatDate(d.date), value: d.newConversations }))}
              format={(v) => formatNumber(v)}
            />
          </Card>
          {currencies.map((c) => (
            <Card key={c} className="sm:p-6">
              <h2 className="m-0 mb-2 text-base font-bold">Ingresos por día ({c})</h2>
              <BarChart
                title={`Ingresos por día en ${c}`}
                points={data.daily.map((d) => ({ label: formatDate(d.date), value: dayRevenue(d, c) }))}
                format={(v) => formatMoneyMinor(v, c)}
              />
            </Card>
          ))}

          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="sm:p-6">
              <h2 className="m-0 mb-3 flex items-center gap-2 text-base font-bold">
                <ShoppingBag aria-hidden className="size-5" />
                Pedidos por estado
              </h2>
              <ul className="m-0 grid list-none gap-1.5 p-0 text-sm">
                {Object.entries(t.ordersByStatus).map(([s, n]) => (
                  <li key={s} className="flex justify-between">
                    <span>{STATUS_LABEL[s] ?? s}</span>
                    <b>{formatNumber(n)}</b>
                  </li>
                ))}
              </ul>
            </Card>
            <Card className="sm:p-6">
              <h2 className="m-0 mb-3 text-base font-bold">Productos más vendidos</h2>
              {data.topProducts.length ? (
                <table className="w-full text-left text-sm">
                  <thead className="text-xs text-muted">
                    <tr>
                      <th scope="col" className="pb-1 font-semibold">Producto</th>
                      <th scope="col" className="pb-1 text-right font-semibold">Uds.</th>
                      <th scope="col" className="pb-1 text-right font-semibold">Ingresos</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.topProducts.map((p) => (
                      <tr key={`${p.productId ?? p.name}-${p.currency}`}>
                        <td className="py-1 pr-2">{p.name}</td>
                        <td className="py-1 text-right">{formatNumber(p.quantity)}</td>
                        <td className="py-1 text-right">{formatMoneyMinor(p.revenueMinor, p.currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="m-0 text-sm text-muted">Aún no hay ventas en este rango.</p>
              )}
            </Card>
          </div>
        </div>
      ) : null}
    </>
  );
}
