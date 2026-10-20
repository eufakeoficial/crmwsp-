"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/app/EmptyState";
import { formatNumber } from "@/lib/format";
import { formatUsd, platformApi, recentMonths } from "@/lib/platform-api";
import { Loading, Table, fieldClass, td, useAsync } from "./shared";

const monthLabel = (m: string) =>
  new Intl.DateTimeFormat("es", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${m}-01T00:00:00Z`));

/** Consumption per tenant in a month, sorted by AI cost. */
export function UsagePage() {
  const months = useMemo(() => recentMonths(12), []);
  const [month, setMonth] = useState(months[0] ?? "");
  const state = useAsync(() => platformApi.usage({ month }), [month]);
  const items = state.data?.items ?? [];
  const totals = state.data?.totals;
  return (
    <>
      <PageHeader title="Uso y consumo" subtitle="Consumo de cada empresa en el mes, ordenado por coste de IA." />
      <div className="mb-3 flex flex-wrap gap-2">
        <select aria-label="Mes" value={month} onChange={(e) => setMonth(e.target.value)} className={fieldClass}>
          {months.map((m) => (
            <option key={m} value={m}>
              {monthLabel(m)}
            </option>
          ))}
        </select>
      </div>
      <Loading state={state}>
        {totals ? (
          <div className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-4">
            {[
              ["Mensajes IA", formatNumber(totals.aiMessages)],
              ["Envíos masivos", formatNumber(totals.broadcastSends)],
              ["Caracteres de voz", formatNumber(totals.ttsCharacters)],
              ["Coste IA", formatUsd(totals.aiCostUsd)],
            ].map(([label, value]) => (
              <div key={label} className="rounded-[16px] bg-white p-3">
                <span className="block text-[11px] font-extrabold text-muted uppercase">{label}</span>
                <b className="text-[18px]">{value}</b>
              </div>
            ))}
          </div>
        ) : null}
        {items.length === 0 ? (
          <p className="rounded-[16px] bg-white p-6 text-center text-sm text-muted">Sin consumo registrado en este mes.</p>
        ) : (
          <Table head={["Empresa", "Plan", "Mensajes IA", "Envíos masivos", "Caracteres de voz", "Coste IA"]}>
            {items.map((r) => (
              <tr key={r.tenantId}>
                <td className={td}>
                  <Link href={`/app/admin/tenants/${r.tenantId}`} className="font-bold hover:underline">{r.name}</Link>
                  <span className="block text-[11px] text-muted">{r.slug}</span>
                </td>
                <td className={td}>{r.plan === "pro" ? "Pro" : "Start"}</td>
                <td className={td}>{formatNumber(r.aiMessages)}</td>
                <td className={td}>{formatNumber(r.broadcastSends)}</td>
                <td className={td}>{formatNumber(r.ttsCharacters)}</td>
                <td className={`${td} font-bold`}>{formatUsd(r.aiCostUsd)}</td>
              </tr>
            ))}
          </Table>
        )}
      </Loading>
    </>
  );
}
