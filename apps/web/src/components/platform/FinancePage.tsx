"use client";

import { useState } from "react";
import { PageHeader } from "@/components/app/EmptyState";
import { Button } from "@/components/ui";
import { platformApi } from "@/lib/platform-api";
import { Loading, Table, td, useAsync } from "./shared";

const PERIOD: Record<string, string> = { monthly: "Mensual", annual: "Anual" };
const PLAN: Record<string, string> = { start: "Start", pro: "Pro" };

/**
 * Read-only finances (ADR 0018): revenue from our settled charges and the live NOWPayments
 * balance. There is intentionally no withdraw or payout action.
 */
export function FinancePage() {
  const [refresh, setRefresh] = useState(0);
  const state = useAsync(() => platformApi.finance(refresh > 0), [refresh]);
  const f = state.data;
  return (
    <>
      <PageHeader title="Finanzas" subtitle="Ingresos de suscripciones cobradas y saldo de NOWPayments (solo lectura)." />
      <Loading state={state}>
        {f ? (
          <div className="flex flex-col gap-4">
            <div className="grid gap-3 md:grid-cols-3">
              <section className="rounded-[16px] bg-white p-4">
                <p className="m-0 text-[13px] text-muted">Hoy (UTC)</p>
                <p className="m-0 text-[22px] font-extrabold">US${f.revenue.today.usd}</p>
                <p className="m-0 text-[12px] text-muted">{f.revenue.today.count} cobros</p>
              </section>
              <section className="rounded-[16px] bg-white p-4">
                <p className="m-0 text-[13px] text-muted">Este mes (UTC)</p>
                <p className="m-0 text-[22px] font-extrabold">US${f.revenue.month.usd}</p>
                <p className="m-0 text-[12px] text-muted">{f.revenue.month.count} cobros · {f.revenue.couponGrants} canjes sin pago (total)</p>
              </section>
              <section className="rounded-[16px] bg-white p-4">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="m-0 text-[13px] text-muted">Saldo NOWPayments</p>
                  {f.balance.configured ? (
                    <Button size="sm" variant="ghost" onClick={() => setRefresh((n) => n + 1)}>Actualizar</Button>
                  ) : null}
                </div>
                {!f.balance.configured ? (
                  <p className="m-0 mt-1 font-bold">No configurado</p>
                ) : f.balance.ok ? (
                  <>
                    {f.balance.items.length === 0 ? <p className="m-0 mt-1 font-bold">Sin saldo</p> : null}
                    <ul className="m-0 mt-1 list-none p-0 text-[14px]">
                      {f.balance.items.map((i) => (
                        <li key={i.currency}>
                          <b>{i.amount}</b> {i.currency.toUpperCase()}
                          {i.pendingAmount !== "0" ? <span className="text-muted"> (+{i.pendingAmount} pendiente)</span> : null}
                        </li>
                      ))}
                    </ul>
                    <p className="m-0 mt-1 text-[11px] text-muted">Actualizado {new Date(f.balance.fetchedAt).toLocaleTimeString("es")}</p>
                  </>
                ) : (
                  <p className="m-0 mt-1 font-bold text-red-700">
                    {f.balance.error === "auth_failed" ? "Credenciales rechazadas por NOWPayments" : "NOWPayments no responde"}
                  </p>
                )}
              </section>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <Table head={["Plan", "Ingresos", "Cobros"]}>
                {f.revenue.byPlan.map((r) => (
                  <tr key={r.key}>
                    <td className={td}>{PLAN[r.key] ?? r.key}</td>
                    <td className={td}>US${r.usd}</td>
                    <td className={td}>{r.count}</td>
                  </tr>
                ))}
              </Table>
              <Table head={["Período", "Ingresos", "Cobros"]}>
                {f.revenue.byPeriod.map((r) => (
                  <tr key={r.key}>
                    <td className={td}>{PERIOD[r.key] ?? r.key}</td>
                    <td className={td}>US${r.usd}</td>
                    <td className={td}>{r.count}</td>
                  </tr>
                ))}
              </Table>
            </div>
            <h2 className="m-0 text-[15px] font-extrabold">Conciliación (orientativa)</h2>
            <Table head={["Moneda", "Recibido por cobros", "Equivale (USD)", "Saldo actual", "Diferencia"]}>
              {f.reconciliation.map((r) => (
                <tr key={r.currency}>
                  <td className={td}>{r.currency.toUpperCase()}</td>
                  <td className={td}>{r.paidCrypto}</td>
                  <td className={td}>US${r.paidUsd}</td>
                  <td className={td}>{r.balance ?? "—"}</td>
                  <td className={td}>{r.difference ?? "—"}</td>
                </tr>
              ))}
            </Table>
            <p className="m-0 text-[12px] text-muted">
              Una diferencia negativa suele deberse a retiros o comisiones hechos en NOWPayments. Los retiros se gestionan solo en el panel de NOWPayments.
            </p>
          </div>
        ) : null}
      </Loading>
    </>
  );
}
