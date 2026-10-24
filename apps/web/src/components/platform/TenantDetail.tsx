"use client";

import type { LimitsOverride, PlatformPlanId, PlatformTenant } from "@crmwsp/contracts";
import Link from "next/link";
import { useState } from "react";
import { PageHeader } from "@/components/app/EmptyState";
import { Button } from "@/components/ui";
import { formatDate, formatDateTime, formatMoneyMinor, formatNumber } from "@/lib/format";
import { ACTION_LABELS, PAYMENT_METHOD_LABELS, STATUS_ACTIONS, platformApi, platformErrorMessage } from "@/lib/platform-api";
import { RecordPaymentForm } from "./PaymentsPage";
import { Loading, StatusPill, Table, fieldClass, td, useAsync } from "./shared";
import { useStatusAction } from "./TenantsList";

const LIMIT_LABELS: Record<keyof LimitsOverride, string> = {
  ai_messages: "Mensajes IA / mes",
  broadcast_sends: "Envíos de difusión / mes",
  contacts: "Contactos",
  seats: "Puestos",
  whatsapp_numbers: "Números WhatsApp",
};
const ROLE_ES: Record<string, string> = { owner: "Propietario", admin: "Administrador", agent: "Agente", viewer: "Lector" };

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-[16px] bg-white p-3">
      <h2 className="m-0 mb-2 text-[14px] font-extrabold">{title}</h2>
      {children}
    </section>
  );
}

function PlanEditor({ tenant, onSaved }: { tenant: PlatformTenant; onSaved: () => void }) {
  const [plan, setPlan] = useState<PlatformPlanId>(tenant.plan);
  const [limits, setLimits] = useState<Record<string, string>>(
    Object.fromEntries(Object.entries(tenant.limitsOverride ?? {}).map(([k, v]) => [k, v === null ? "" : String(v)])),
  );
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const override: Record<string, number> = {};
    for (const [k, v] of Object.entries(limits)) if (v.trim() !== "") override[k] = Number(v);
    if (Object.values(override).some((n) => !Number.isInteger(n) || n < 0)) {
      setMsg("Los límites deben ser enteros ≥ 0.");
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      await platformApi.changePlan(tenant.id, { plan, limitsOverride: Object.keys(override).length ? (override as LimitsOverride) : null });
      setMsg("Plan guardado. Efectivo de inmediato.");
      onSaved();
    } catch (err) {
      setMsg(platformErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-2">
      <label className="flex items-center gap-2 text-[13px] font-bold">
        Plan
        <select value={plan} onChange={(e) => setPlan(e.target.value as PlatformPlanId)} className={fieldClass}>
          <option value="start">Start</option>
          <option value="pro">Pro</option>
        </select>
      </label>
      <p className="m-0 text-[12px] text-muted">Límites a medida (opcional, vacío = los del plan):</p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {(Object.keys(LIMIT_LABELS) as (keyof LimitsOverride)[]).map((k) => (
          <label key={k} className="flex flex-col gap-1 text-[12px] font-bold">
            {LIMIT_LABELS[k]}
            <input inputMode="numeric" value={limits[k] ?? ""} onChange={(e) => setLimits((l) => ({ ...l, [k]: e.target.value }))} className={fieldClass} />
          </label>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" disabled={busy} onClick={() => void save()}>Guardar plan</Button>
        {msg ? <span className="text-[12px] text-muted" role="status">{msg}</span> : null}
      </div>
    </div>
  );
}

/** Extend a new tenant's setup or trial by N days (ADR 0015). Audited server side. */
function LifecycleEditor({ tenantId }: { tenantId: string }) {
  const [kind, setKind] = useState<"setup" | "trial">("trial");
  const [days, setDays] = useState("7");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const n = Number(days);
    if (!Number.isInteger(n) || n < 1 || n > 90) {
      setMsg("Los días deben ser un entero entre 1 y 90.");
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const r = await platformApi.extendLifecycle(tenantId, { kind, days: n });
      setMsg(`${kind === "setup" ? "Configuración" : "Prueba"} extendida hasta ${formatDateTime(r.endsAt)}.`);
    } catch (err) {
      setMsg(platformErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="flex flex-col gap-1 text-[12px] font-bold">
        Etapa
        <select value={kind} onChange={(e) => setKind(e.target.value as "setup" | "trial")} className={fieldClass}>
          <option value="setup">Configuración (sin WhatsApp)</option>
          <option value="trial">Prueba gratuita</option>
        </select>
      </label>
      <label className="flex flex-col gap-1 text-[12px] font-bold">
        Días
        <input inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} className={fieldClass} />
      </label>
      <Button size="sm" disabled={busy} onClick={() => void save()}>Extender</Button>
      {msg ? <span className="text-[12px] text-muted" role="status">{msg}</span> : null}
    </div>
  );
}

export function TenantDetail({ id }: { id: string }) {
  const state = useAsync(() => platformApi.tenant(id), [id]);
  const actions = useStatusAction(() => state.reload());
  const d = state.data;
  const t = d?.tenant;
  return (
    <>
      <Link href="/app/admin/tenants" className="mb-2 inline-block text-[13px] font-bold underline">← Empresas</Link>
      <Loading state={state}>
        {d && t ? (
          <>
            <PageHeader title={t.name} subtitle={`${t.slug} · alta ${formatDate(t.createdAt)}${t.lastActivityAt ? ` · última actividad ${formatDateTime(t.lastActivityAt)}` : ""}`} />
            {actions.error ? <p className="mb-2 rounded-xl bg-danger-soft p-2.5 text-[13px] text-danger" role="alert">{actions.error}</p> : null}
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              <Section title="Estado">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusPill status={t.status} />
                  {t.statusReason ? <span className="text-[13px] text-muted">Motivo: {t.statusReason}</span> : null}
                  {t.overdue ? <span className="rounded-full bg-danger-soft px-2 py-0.5 text-[11px] font-bold text-danger">Pago atrasado</span> : null}
                </div>
                <p className="mt-2 mb-2 text-[13px]">Propietario: {t.ownerName ? `${t.ownerName} · ` : ""}{t.ownerEmail ?? "—"}</p>
                <div className="flex flex-wrap gap-1.5">
                  {STATUS_ACTIONS[t.status].map((a) => (
                    <Button key={a} size="sm" variant={a === "approve" || a === "reactivate" ? "accent" : "outline"} disabled={actions.busy} onClick={() => actions.start(t, a)}>
                      {ACTION_LABELS[a]}
                    </Button>
                  ))}
                </div>
              </Section>
              <Section title={`Uso del mes (${t.usagePeriod})`}>
                <ul className="m-0 grid list-none grid-cols-3 gap-2 p-0 text-[13px]">
                  <li className="rounded-xl bg-paper p-2"><span className="block text-muted">Mensajes IA</span><b>{formatNumber(t.aiMessages)}</b></li>
                  <li className="rounded-xl bg-paper p-2"><span className="block text-muted">Difusiones</span><b>{formatNumber(t.broadcastSends)}</b></li>
                  <li className="rounded-xl bg-paper p-2"><span className="block text-muted">Puestos</span><b>{formatNumber(t.seats)}</b></li>
                </ul>
              </Section>
              <Section title="Plan">
                <PlanEditor key={`${t.plan}-${JSON.stringify(t.limitsOverride)}`} tenant={t} onSaved={state.reload} />
              </Section>
              <Section title="Prueba gratuita">
                <LifecycleEditor tenantId={t.id} />
              </Section>
              <Section title="Miembros y canales">
                <ul className="m-0 list-none p-0 text-[13px]">
                  {d.members.map((m) => (
                    <li key={m.email} className="flex justify-between gap-2 border-b border-paper py-1.5">
                      <span className="min-w-0 truncate">{m.name ? `${m.name} · ` : ""}{m.email}</span>
                      <span className="text-muted">{ROLE_ES[m.role] ?? m.role}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 mb-0 text-[13px]">
                  Canales: {d.channels.length === 0 ? "ninguno" : d.channels.map((c) => c.status).join(", ")}
                </p>
              </Section>
            </div>
            <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
              <Section title={`Pagos de suscripción${t.paidUntil ? ` · pagado hasta ${formatDate(`${t.paidUntil}T00:00:00Z`)}` : ""}`}>
                <RecordPaymentForm tenantId={t.id} onSaved={state.reload} />
                {d.payments.length ? (
                  <ul className="mt-2 mb-0 list-none p-0 text-[13px]">
                    {d.payments.map((p) => (
                      <li key={p.id} className="flex justify-between gap-2 border-b border-paper py-1.5">
                        <span>{p.periodStart} → {p.periodEnd} · {PAYMENT_METHOD_LABELS[p.method] ?? p.method}{p.reference ? ` · ${p.reference}` : ""}</span>
                        <b>{formatMoneyMinor(p.amountMinor, p.currency)}</b>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </Section>
              <Section title="Registro de actividad">
                {d.audit.length === 0 ? (
                  <p className="m-0 text-[13px] text-muted">Sin acciones registradas.</p>
                ) : (
                  <Table head={["Fecha", "Acción", "Admin"]}>
                    {d.audit.map((e) => (
                      <tr key={e.id}>
                        <td className={td}>{formatDateTime(e.createdAt)}</td>
                        <td className={td}>{e.action}</td>
                        <td className={td}>{e.actorEmail ?? "CLI"}</td>
                      </tr>
                    ))}
                  </Table>
                )}
              </Section>
            </div>
          </>
        ) : null}
      </Loading>
      {actions.dialog}
    </>
  );
}
