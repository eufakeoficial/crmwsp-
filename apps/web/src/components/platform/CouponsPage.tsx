"use client";

import { useState } from "react";
import type { PlatformCoupon, PlatformCouponSaveRequest } from "@crmwsp/contracts";
import { PageHeader } from "@/components/app/EmptyState";
import { Alert, Button } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { platformApi, platformErrorMessage } from "@/lib/platform-api";
import { Loading, Table, fieldClass, td, useAsync } from "./shared";

const TYPE_LABEL: Record<PlatformCoupon["type"], string> = { percent: "% descuento", fixed_usd: "US$ descuento", free_days: "Días gratis" };
const PERIOD_LABEL: Record<PlatformCoupon["period"], string> = { monthly: "Mensual", annual: "Anual", any: "Cualquiera" };

function valueText(c: Pick<PlatformCoupon, "type" | "value">): string {
  if (c.type === "percent") return `${c.value}%`;
  if (c.type === "fixed_usd") return `US$${c.value.toFixed(2)}`;
  return `${c.value} días`;
}

const empty: PlatformCouponSaveRequest = {
  code: "",
  type: "percent",
  value: 10,
  plans: [],
  period: "any",
  maxRedemptions: null,
  perTenantLimit: 1,
  validFrom: null,
  validUntil: null,
  active: true,
};

const toLocal = (iso: string | null) => (iso ? iso.slice(0, 16) : "");
const fromLocal = (v: string) => (v ? new Date(v).toISOString() : null);

function CouponForm({ initial, id, onDone }: { initial: PlatformCouponSaveRequest; id: string | null; onDone: () => void }) {
  const [f, setF] = useState(initial);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof PlatformCouponSaveRequest>(k: K, v: PlatformCouponSaveRequest[K]) => setF((x) => ({ ...x, [k]: v }));
  const save = () => {
    setBusy(true);
    setError(undefined);
    (id ? platformApi.updateCoupon(id, f) : platformApi.createCoupon(f)).then(onDone, (err: unknown) => setError(platformErrorMessage(err))).finally(() => setBusy(false));
  };
  return (
    <section className="mb-4 rounded-[16px] bg-white p-4 text-[13px]">
      {error ? <Alert>{error}</Alert> : null}
      <div className="grid gap-3 md:grid-cols-3">
        <label className="flex flex-col gap-1">
          Código
          <input className={fieldClass} value={f.code} disabled={id !== null} maxLength={32} onChange={(e) => set("code", e.target.value.toUpperCase())} />
        </label>
        <label className="flex flex-col gap-1">
          Tipo
          <select className={fieldClass} value={f.type} disabled={id !== null} onChange={(e) => set("type", e.target.value as PlatformCoupon["type"])}>
            {Object.entries(TYPE_LABEL).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          Valor
          <input className={fieldClass} type="number" min={0} step={f.type === "fixed_usd" ? 0.01 : 1} value={f.value} onChange={(e) => set("value", Number(e.target.value))} />
        </label>
        <label className="flex flex-col gap-1">
          Período
          <select className={fieldClass} value={f.period} onChange={(e) => set("period", e.target.value as PlatformCoupon["period"])}>
            {Object.entries(PERIOD_LABEL).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </label>
        <fieldset className="flex items-end gap-3">
          <legend className="mb-1">Planes (ninguno = todos)</legend>
          {(["start", "pro"] as const).map((p) => (
            <label key={p} className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={f.plans.includes(p)}
                onChange={(e) => set("plans", e.target.checked ? [...f.plans, p] : f.plans.filter((x) => x !== p))}
              />
              {p === "pro" ? "Pro" : "Start"}
            </label>
          ))}
        </fieldset>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={f.active} onChange={(e) => set("active", e.target.checked)} /> Activo
        </label>
        <label className="flex flex-col gap-1">
          Usos máximos (vacío = sin límite)
          <input className={fieldClass} type="number" min={1} value={f.maxRedemptions ?? ""} onChange={(e) => set("maxRedemptions", e.target.value ? Number(e.target.value) : null)} />
        </label>
        <label className="flex flex-col gap-1">
          Usos por empresa
          <input className={fieldClass} type="number" min={1} value={f.perTenantLimit} onChange={(e) => set("perTenantLimit", Number(e.target.value) || 1)} />
        </label>
        <div />
        <label className="flex flex-col gap-1">
          Válido desde
          <input className={fieldClass} type="datetime-local" value={toLocal(f.validFrom)} onChange={(e) => set("validFrom", fromLocal(e.target.value))} />
        </label>
        <label className="flex flex-col gap-1">
          Válido hasta
          <input className={fieldClass} type="datetime-local" value={toLocal(f.validUntil)} onChange={(e) => set("validUntil", fromLocal(e.target.value))} />
        </label>
      </div>
      <div className="mt-3 flex gap-2">
        <Button size="sm" disabled={busy} onClick={save}>{id ? "Guardar cambios" : "Crear cupón"}</Button>
        <Button size="sm" variant="ghost" onClick={onDone}>Cancelar</Button>
      </div>
    </section>
  );
}

function Redemptions({ couponId }: { couponId: string }) {
  const state = useAsync(() => platformApi.couponRedemptions(couponId), [couponId]);
  return (
    <Loading state={state}>
      {(state.data?.items.length ?? 0) === 0 ? (
        <p className="text-[13px] text-muted">Sin canjes todavía.</p>
      ) : (
        <Table head={["Empresa", "Plan", "Descuento", "Pagado", "Fecha"]}>
          {state.data?.items.map((r) => (
            <tr key={r.id}>
              <td className={td}>{r.tenantName}</td>
              <td className={td}>{r.plan === "pro" ? "Pro" : "Start"}</td>
              <td className={td}>{r.freeDays > 0 ? `${r.freeDays} días` : `US$${r.discountAmount}`}</td>
              <td className={td}>US${r.priceAmount}</td>
              <td className={td}>{formatDate(r.createdAt)}</td>
            </tr>
          ))}
        </Table>
      )}
    </Loading>
  );
}

/** Subscription coupons (ADR 0017): create, edit, deactivate, delete unused, see redemptions. */
export function CouponsPage() {
  const state = useAsync(() => platformApi.coupons(), []);
  const [editing, setEditing] = useState<{ id: string | null; initial: PlatformCouponSaveRequest } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string>();
  const done = () => {
    setEditing(null);
    state.reload();
  };
  const remove = (c: PlatformCoupon) => {
    if (!window.confirm(`¿Eliminar el cupón ${c.code}?`)) return;
    platformApi.deleteCoupon(c.id).then(state.reload, (err: unknown) => setError(platformErrorMessage(err)));
  };
  return (
    <>
      <PageHeader title="Cupones" subtitle="Descuentos y días gratis para la suscripción. Un uso cuenta cuando el pago se confirma." />
      {error ? <Alert>{error}</Alert> : null}
      {editing ? (
        <CouponForm initial={editing.initial} id={editing.id} onDone={done} />
      ) : (
        <div className="mb-3">
          <Button size="sm" onClick={() => setEditing({ id: null, initial: empty })}>Nuevo cupón</Button>
        </div>
      )}
      <Loading state={state}>
        {(state.data?.items.length ?? 0) === 0 ? (
          <p className="rounded-[16px] bg-white p-6 text-center text-sm text-muted">No hay cupones.</p>
        ) : (
          <Table head={["Código", "Beneficio", "Aplica a", "Usos", "Vigencia", "Estado", ""]}>
            {state.data?.items.map((c) => (
              <tr key={c.id}>
                <td className={td}><b>{c.code}</b></td>
                <td className={td}>{valueText(c)}</td>
                <td className={td}>
                  {c.plans.length === 0 ? "Todos los planes" : c.plans.map((p) => (p === "pro" ? "Pro" : "Start")).join(", ")} · {PERIOD_LABEL[c.period]}
                </td>
                <td className={td}>
                  <button type="button" className="font-bold hover:underline" onClick={() => setOpen(open === c.id ? null : c.id)}>
                    {c.redemptions}
                    {c.maxRedemptions !== null ? ` / ${c.maxRedemptions}` : ""}
                  </button>
                  {c.holds > 0 ? <span className="block text-[11px] text-muted">{c.holds} pendiente(s)</span> : null}
                  {open === c.id ? <div className="mt-2"><Redemptions couponId={c.id} /></div> : null}
                </td>
                <td className={td}>
                  {c.validFrom ? formatDate(c.validFrom) : "—"} → {c.validUntil ? formatDate(c.validUntil) : "sin fin"}
                </td>
                <td className={td}>{c.active ? "Activo" : "Inactivo"}</td>
                <td className={td}>
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        setEditing({
                          id: c.id,
                          initial: {
                            code: c.code,
                            type: c.type,
                            value: c.value,
                            plans: c.plans,
                            period: c.period,
                            maxRedemptions: c.maxRedemptions,
                            perTenantLimit: c.perTenantLimit,
                            validFrom: c.validFrom,
                            validUntil: c.validUntil,
                            active: c.active,
                          },
                        })
                      }
                    >
                      Editar
                    </Button>
                    {c.redemptions === 0 && c.holds === 0 ? (
                      <Button size="sm" variant="ghost" onClick={() => remove(c)}>Eliminar</Button>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Loading>
    </>
  );
}
