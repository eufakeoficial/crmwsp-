"use client";

import { useState } from "react";
import type { CategoryActionDto, PlatformBusinessCategory } from "@crmwsp/contracts";
import { PageHeader } from "@/components/app/EmptyState";
import { Alert, Button } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { platformErrorMessage } from "@/lib/platform-api";
import { CATEGORY_ACTION_LABELS, CATEGORY_REVIEW_LABELS, policiesPlatformApi } from "@/lib/policies-api";
import { Loading, Table, fieldClass, td, useAsync } from "./shared";

/** Pending category reviews (ADR 0021): approve, or reject with a reason. Both are audited. */
function CategoryReviews() {
  const [status, setStatus] = useState("pending");
  const state = useAsync(() => policiesPlatformApi.reviews(status), [status]);
  const [error, setError] = useState<string>();
  const decide = (tenantId: string, approve: boolean) => {
    const reason = approve ? undefined : (window.prompt("Motivo del rechazo (lo verá el propietario):") ?? "").trim();
    if (!approve && !reason) return;
    setError(undefined);
    policiesPlatformApi.decide(tenantId, { approve, ...(reason ? { reason } : {}) }).then(state.reload, (err: unknown) => setError(platformErrorMessage(err)));
  };
  return (
    <section className="mb-6">
      <div className="mb-2 flex items-center gap-2">
        <h2 className="text-[15px] font-extrabold">Revisión de rubros</h2>
        <select aria-label="Estado" className={fieldClass} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="pending">Pendientes</option>
          <option value="approved">Aprobados</option>
          <option value="rejected">Rechazados</option>
          <option value="none">Sin revisión</option>
          <option value="unset">Sin rubro</option>
        </select>
      </div>
      {error ? <Alert>{error}</Alert> : null}
      <Loading state={state}>
        <Table head={["Empresa", "Propietario", "Rubro", "Detalle", "Estado", "Fecha", ""]}>
          {(state.data?.items ?? []).map((r) => (
            <tr key={r.tenantId}>
              <td className={td}>{r.name}</td>
              <td className={td}>{r.ownerEmail ?? "—"}</td>
              <td className={td}>{r.categoryLabel ?? "—"}</td>
              <td className={td}>{r.detail ?? "—"}</td>
              <td className={td}>{CATEGORY_REVIEW_LABELS[r.reviewStatus]}{r.reviewReason ? ` · ${r.reviewReason}` : ""}</td>
              <td className={td}>{r.setAt ? formatDate(r.setAt) : "—"}</td>
              <td className={td}>
                {r.reviewStatus === "pending" ? (
                  <span className="flex gap-2">
                    <Button size="sm" onClick={() => decide(r.tenantId, true)}>Aprobar</Button>
                    <Button size="sm" variant="ghost" onClick={() => decide(r.tenantId, false)}>Rechazar</Button>
                  </span>
                ) : null}
              </td>
            </tr>
          ))}
        </Table>
      </Loading>
    </section>
  );
}

/** Warning/critical Meta events on tenant numbers (quality drops, restrictions, paused templates). */
function QualityAlerts() {
  const state = useAsync(() => policiesPlatformApi.qualityAlerts(30), []);
  return (
    <section className="mb-6">
      <h2 className="mb-2 text-[15px] font-extrabold">Alertas de calidad (30 días)</h2>
      <p className="mb-2 text-[12px] text-muted">Solo llegan si el BSP reenvía los eventos de cuenta de Meta.</p>
      <Loading state={state}>
        <Table head={["Fecha", "Empresa", "Número", "Evento", "Motivo", "Gravedad", "Estado"]}>
          {(state.data?.items ?? []).map((a) => (
            <tr key={a.eventId}>
              <td className={td}>{formatDate(a.createdAt)}</td>
              <td className={td}>{a.tenantName}</td>
              <td className={td}>…{a.phoneLast4} · {a.provider}</td>
              <td className={td}>{a.field} · {a.event ?? a.quality ?? "—"}</td>
              <td className={td}>{a.reason ?? "—"}</td>
              <td className={td}>{a.severity === "critical" ? "Crítica" : "Advertencia"}</td>
              <td className={td}>{a.accountStatus}</td>
            </tr>
          ))}
        </Table>
      </Loading>
    </section>
  );
}

/** Category rules (data-driven). Editing never re-evaluates existing tenants. */
function CategoryRules() {
  const state = useAsync(() => policiesPlatformApi.categories(), []);
  const [error, setError] = useState<string>();
  const save = (c: PlatformBusinessCategory, action: CategoryActionDto, guidance: string | null) => {
    setError(undefined);
    policiesPlatformApi
      .upsertCategory(c.key, { label: c.label, action, guidance, sortOrder: c.sortOrder, active: c.active })
      .then(state.reload, (err: unknown) => setError(platformErrorMessage(err)));
  };
  return (
    <section className="mb-6">
      <h2 className="mb-2 text-[15px] font-extrabold">Reglas de rubros</h2>
      <p className="mb-2 text-[12px] text-muted">Cambiar una regla no afecta a las empresas existentes: se aplica a las nuevas declaraciones.</p>
      {error ? <Alert>{error}</Alert> : null}
      <Loading state={state}>
        <Table head={["Rubro", "Acción", "Guía", "Empresas"]}>
          {(state.data?.items ?? []).map((c) => (
            <tr key={c.key}>
              <td className={td}>{c.label}</td>
              <td className={td}>
                <select aria-label={`Acción para ${c.label}`} className={fieldClass} value={c.action} onChange={(e) => save(c, e.target.value as CategoryActionDto, c.guidance)}>
                  {Object.entries(CATEGORY_ACTION_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </td>
              <td className={td}>
                <input
                  aria-label={`Guía para ${c.label}`}
                  className={`${fieldClass} w-full`}
                  defaultValue={c.guidance ?? ""}
                  maxLength={1000}
                  onBlur={(e) => {
                    const v = e.target.value.trim() || null;
                    if (v !== c.guidance) save(c, c.action, v);
                  }}
                />
              </td>
              <td className={td}>{c.tenantCount}</td>
            </tr>
          ))}
        </Table>
      </Loading>
    </section>
  );
}

export function PoliciesPage() {
  return (
    <div>
      <PageHeader title="Políticas de WhatsApp" />
      <CategoryReviews />
      <QualityAlerts />
      <CategoryRules />
    </div>
  );
}
