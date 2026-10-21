"use client";

import type { SubscriptionPaymentMethod } from "@crmwsp/contracts";
import Link from "next/link";
import { useState } from "react";
import { PageHeader } from "@/components/app/EmptyState";
import { Button } from "@/components/ui";
import { formatDate, formatMoneyMinor, majorToMinor } from "@/lib/format";
import { PAYMENT_METHOD_LABELS, platformApi, platformErrorMessage } from "@/lib/platform-api";
import { Loading, Table, fieldClass, td, useAsync } from "./shared";

const today = () => new Date().toISOString().slice(0, 10);
const plusMonth = (d: string) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCMonth(x.getUTCMonth() + 1);
  x.setUTCDate(x.getUTCDate() - 1);
  return x.toISOString().slice(0, 10);
};

/** Manual entry of a subscription payment (SaaS revenue, not tenant orders). */
export function RecordPaymentForm({ tenantId, onSaved }: { tenantId: string; onSaved: () => void }) {
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [start, setStart] = useState(today());
  const [end, setEnd] = useState(plusMonth(today()));
  const [method, setMethod] = useState<SubscriptionPaymentMethod>("transfer");
  const [reference, setReference] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    const cur = currency.trim().toUpperCase();
    const minor = majorToMinor(amount, cur);
    if (!minor || minor <= 0) {
      setMsg("Importe no válido.");
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      await platformApi.recordPayment({
        tenantId,
        amountMinor: minor,
        currency: cur,
        periodStart: start,
        periodEnd: end,
        method,
        ...(reference.trim() ? { reference: reference.trim() } : {}),
      });
      setAmount("");
      setReference("");
      setMsg("Pago registrado.");
      onSaved();
    } catch (err) {
      setMsg(platformErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="grid grid-cols-2 gap-2 sm:grid-cols-3"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <label className="flex flex-col gap-1 text-[12px] font-bold">Importe<input required inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className={fieldClass} /></label>
      <label className="flex flex-col gap-1 text-[12px] font-bold">Moneda<input required maxLength={3} value={currency} onChange={(e) => setCurrency(e.target.value)} className={fieldClass} /></label>
      <label className="flex flex-col gap-1 text-[12px] font-bold">
        Método
        <select value={method} onChange={(e) => setMethod(e.target.value as SubscriptionPaymentMethod)} className={fieldClass}>
          {Object.entries(PAYMENT_METHOD_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-[12px] font-bold">Desde<input type="date" required value={start} onChange={(e) => setStart(e.target.value)} className={fieldClass} /></label>
      <label className="flex flex-col gap-1 text-[12px] font-bold">Hasta<input type="date" required value={end} onChange={(e) => setEnd(e.target.value)} className={fieldClass} /></label>
      <label className="flex flex-col gap-1 text-[12px] font-bold">Referencia<input maxLength={200} value={reference} onChange={(e) => setReference(e.target.value)} className={fieldClass} /></label>
      <div className="col-span-2 flex items-center gap-2 sm:col-span-3">
        <Button size="sm" type="submit" disabled={busy}>Registrar pago</Button>
        {msg ? <span className="text-[12px] text-muted" role="status">{msg}</span> : null}
      </div>
    </form>
  );
}

export function PaymentsPage() {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const state = useAsync(() => platformApi.payments(month ? { month } : {}), [month]);
  return (
    <>
      <PageHeader title="Pagos" subtitle="Cobros de suscripción registrados a mano. Para registrar uno, abre la empresa." />
      <Loading state={state}>
        {state.data ? (
          <div className="flex flex-col gap-3">
            <div className="rounded-[16px] bg-white p-3">
              <b className="text-[13px]">Totales por mes</b>
              {state.data.totals.length === 0 ? (
                <p className="m-0 mt-1 text-[13px] text-muted">Aún no hay pagos.</p>
              ) : (
                <ul className="mt-2 mb-0 flex list-none flex-wrap gap-2 p-0">
                  {state.data.totals.map((t) => (
                    <li key={`${t.month}-${t.currency}`}>
                      <button
                        type="button"
                        onClick={() => setMonth(t.month)}
                        aria-pressed={t.month === month}
                        className={`cursor-pointer rounded-xl px-3 py-2 text-left text-[13px] ${t.month === month ? "bg-lime-soft" : "bg-paper"}`}
                      >
                        <span className="block text-muted">{t.month} · {t.count} pagos</span>
                        <b>{formatMoneyMinor(t.totalMinor, t.currency)}</b>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <label className="flex items-center gap-2 text-[13px] font-bold">
              Mes
              <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className={fieldClass} />
            </label>
            {state.data.items.length === 0 ? (
              <p className="rounded-[16px] bg-white p-6 text-center text-sm text-muted">Sin pagos en este mes.</p>
            ) : (
              <Table head={["Fecha", "Empresa", "Importe", "Periodo", "Método", "Referencia", "Registrado por"]}>
                {state.data.items.map((p) => (
                  <tr key={p.id}>
                    <td className={td}>{formatDate(p.createdAt)}</td>
                    <td className={td}><Link href={`/app/admin/tenants/${p.tenantId}`} className="font-bold hover:underline">{p.tenantName}</Link></td>
                    <td className={td}>{formatMoneyMinor(p.amountMinor, p.currency)}</td>
                    <td className={td}>{p.periodStart} → {p.periodEnd}</td>
                    <td className={td}>{PAYMENT_METHOD_LABELS[p.method] ?? p.method}</td>
                    <td className={td}>{p.reference ?? "—"}</td>
                    <td className={td}>{p.recordedByEmail ?? "—"}</td>
                  </tr>
                ))}
              </Table>
            )}
          </div>
        ) : null}
      </Loading>
    </>
  );
}
