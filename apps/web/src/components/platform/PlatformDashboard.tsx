"use client";

import { AlertTriangle, Building2, Clock, DollarSign, Receipt } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/app/EmptyState";
import { KpiCard } from "@/components/ui";
import { formatMoney, formatMoneyMinor, formatNumber } from "@/lib/format";
import { TENANT_STATUS_LABELS, platformApi } from "@/lib/platform-api";
import { Loading, useAsync } from "./shared";

export function PlatformDashboard() {
  const state = useAsync(() => platformApi.dashboard(), []);
  const d = state.data;
  const total = d ? Object.values(d.byStatus).reduce((a, b) => a + (b ?? 0), 0) : 0;
  return (
    <>
      <PageHeader title="Backoffice" subtitle="Estado del SaaS: empresas, ingresos estimados y cobros." />
      <Loading state={state}>
        {d ? (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
              <KpiCard label="Empresas" value={formatNumber(total)} icon={Building2} note={`${formatNumber(d.byStatus.active ?? 0)} activas`} />
              <KpiCard label="MRR estimado" value={formatMoney(d.mrrEstimateUsd, "USD")} icon={DollarSign} note="Precio de lista × empresas activas" />
              <KpiCard
                label="Cobrado este mes"
                value={d.paymentsThisMonth.length ? d.paymentsThisMonth.map((p) => formatMoneyMinor(p.totalMinor, p.currency)).join(" · ") : "—"}
                icon={Receipt}
                note={`${formatNumber(d.paymentsThisMonth.reduce((a, p) => a + p.count, 0))} pagos`}
              />
              <KpiCard label="Con pago atrasado" value={formatNumber(d.overdue)} icon={AlertTriangle} tone={d.overdue > 0 ? "danger" : "lime-soft"} />
            </div>
            <div className="rounded-[16px] bg-white p-3">
              <b className="text-[13px]">Empresas por estado</b>
              <ul className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {(Object.keys(TENANT_STATUS_LABELS) as (keyof typeof TENANT_STATUS_LABELS)[]).map((k) => (
                  <li key={k} className="rounded-xl bg-paper px-3 py-2 text-[13px]">
                    <span className="block text-muted">{TENANT_STATUS_LABELS[k]}</span>
                    <b className="text-[17px]">{formatNumber(d.byStatus[k] ?? 0)}</b>
                  </li>
                ))}
              </ul>
              {(d.byStatus.pending_approval ?? 0) > 0 ? (
                <Link href="/app/admin/approvals" className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-bold underline">
                  <Clock aria-hidden className="size-4" />
                  Revisar {d.byStatus.pending_approval} pendiente(s)
                </Link>
              ) : null}
            </div>
          </div>
        ) : null}
      </Loading>
    </>
  );
}
