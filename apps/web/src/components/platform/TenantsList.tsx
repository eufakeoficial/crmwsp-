"use client";

import type { PlatformPlanId, PlatformTenant, TenantStatus, TenantStatusAction } from "@crmwsp/contracts";
import Link from "next/link";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/app/EmptyState";
import { Button, ReasonDialog } from "@/components/ui";
import { formatDate, formatNumber } from "@/lib/format";
import { ACTION_LABELS, TENANT_STATUS_LABELS, actionRequiresReason, platformApi, platformErrorMessage } from "@/lib/platform-api";
import { Loading, StatusPill, Table, fieldClass, td, useAsync } from "./shared";

/** Approve/reject/suspend/reactivate with a reason dialog when required. */
export function useStatusAction(onDone: (t: PlatformTenant) => void) {
  const [pending, setPending] = useState<{ tenant: PlatformTenant; action: TenantStatusAction } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (tenantId: string, action: TenantStatusAction, reason?: string) => {
    setBusy(true);
    setError(null);
    try {
      onDone(await platformApi.changeStatus(tenantId, { action, ...(reason ? { reason } : {}) }));
    } catch (err) {
      setError(platformErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const start = (tenant: PlatformTenant, action: TenantStatusAction) => {
    if (actionRequiresReason(action)) setPending({ tenant, action });
    else void run(tenant.id, action);
  };
  const dialog = pending ? (
    <ReasonDialog
      title={`${ACTION_LABELS[pending.action]} ${pending.tenant.name}`}
      description="El propietario recibirá un correo con este motivo."
      confirmLabel={ACTION_LABELS[pending.action]}
      onCancel={() => setPending(null)}
      onConfirm={(reason) => {
        const p = pending;
        setPending(null);
        void run(p.tenant.id, p.action, reason);
      }}
    />
  ) : null;
  return { start, dialog, error, busy };
}

export function TenantsList({ mode = "all" }: { mode?: "all" | "approvals" }) {
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<TenantStatus | "">(mode === "approvals" ? "pending_approval" : "");
  const [plan, setPlan] = useState<PlatformPlanId | "">("");
  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);
  const state = useAsync(
    () => platformApi.tenants({ ...(query ? { q: query } : {}), ...(status ? { status } : {}), ...(plan ? { plan } : {}) }),
    [query, status, plan],
  );
  const actions = useStatusAction(() => state.reload());
  const items = state.data?.items ?? [];
  return (
    <>
      <PageHeader
        title={mode === "approvals" ? "Aprobaciones" : "Empresas"}
        subtitle={mode === "approvals" ? "Altas nuevas que esperan revisión." : "Todas las empresas del SaaS. Sin acceso a conversaciones ni contactos."}
      />
      {mode === "all" ? (
        <div className="mb-3 flex flex-wrap gap-2">
          <input aria-label="Buscar" placeholder="Buscar por nombre, slug o email" value={q} onChange={(e) => setQ(e.target.value)} className={`${fieldClass} min-w-0 flex-1 sm:max-w-xs`} />
          <select aria-label="Estado" value={status} onChange={(e) => setStatus(e.target.value as TenantStatus | "")} className={fieldClass}>
            <option value="">Todos los estados</option>
            {(Object.keys(TENANT_STATUS_LABELS) as TenantStatus[]).map((s) => (
              <option key={s} value={s}>
                {TENANT_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
          <select aria-label="Plan" value={plan} onChange={(e) => setPlan(e.target.value as PlatformPlanId | "")} className={fieldClass}>
            <option value="">Todos los planes</option>
            <option value="start">Start</option>
            <option value="pro">Pro</option>
          </select>
        </div>
      ) : null}
      {actions.error ? <p className="mb-2 rounded-xl bg-danger-soft p-2.5 text-[13px] text-danger" role="alert">{actions.error}</p> : null}
      <Loading state={state}>
        {items.length === 0 ? (
          <p className="rounded-[16px] bg-white p-6 text-center text-sm text-muted">{mode === "approvals" ? "No hay altas pendientes." : "Sin resultados."}</p>
        ) : mode === "approvals" ? (
          <Table head={["Empresa", "Propietario", "Alta", "Acciones"]}>
            {items.map((t) => (
              <tr key={t.id}>
                <td className={td}>
                  <Link href={`/app/admin/tenants/${t.id}`} className="font-bold hover:underline">{t.name}</Link>
                  <span className="block text-[11px] text-muted">{t.slug}</span>
                </td>
                <td className={td}>{t.ownerEmail ?? "—"}</td>
                <td className={td}>{formatDate(t.createdAt)}</td>
                <td className={td}>
                  <div className="flex gap-1.5">
                    <Button size="sm" variant="accent" disabled={actions.busy} onClick={() => actions.start(t, "approve")}>Aprobar</Button>
                    <Button size="sm" variant="outline" disabled={actions.busy} onClick={() => actions.start(t, "reject")}>Rechazar</Button>
                  </div>
                </td>
              </tr>
            ))}
          </Table>
        ) : (
          <Table head={["Empresa", "Estado", "Plan", "Propietario", "Miembros", "IA (mes)", "Canales", "Pagado hasta", "Última actividad"]}>
            {items.map((t) => (
              <tr key={t.id}>
                <td className={td}>
                  <Link href={`/app/admin/tenants/${t.id}`} className="font-bold hover:underline">{t.name}</Link>
                  <span className="block text-[11px] text-muted">{t.slug} · {formatDate(t.createdAt)}</span>
                </td>
                <td className={td}><StatusPill status={t.status} /></td>
                <td className={td}>{t.plan === "pro" ? "Pro" : "Start"}{t.limitsOverride ? " *" : ""}</td>
                <td className={td}>{t.ownerEmail ?? "—"}</td>
                <td className={td}>{formatNumber(t.memberCount)}</td>
                <td className={td}>{formatNumber(t.aiMessages)}</td>
                <td className={td}>{formatNumber(t.channelCount)}</td>
                <td className={td}>
                  {t.paidUntil ? formatDate(`${t.paidUntil}T00:00:00Z`) : "—"}
                  {t.overdue ? <span className="ml-1.5 rounded-full bg-danger-soft px-1.5 py-0.5 text-[11px] font-bold text-danger">Atrasado</span> : null}
                </td>
                <td className={td}>{t.lastActivityAt ? formatDate(t.lastActivityAt) : "—"}</td>
              </tr>
            ))}
          </Table>
        )}
      </Loading>
      {actions.dialog}
    </>
  );
}
