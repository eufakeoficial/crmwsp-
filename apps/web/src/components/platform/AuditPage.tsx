"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/app/EmptyState";
import { Button } from "@/components/ui";
import { formatDateTime, formatNumber } from "@/lib/format";
import { AUDIT_ACTION_LABELS, platformApi } from "@/lib/platform-api";
import { Loading, Table, fieldClass, td, useAsync } from "./shared";

interface Filters {
  actor: string;
  action: string;
  tenant: string;
  from: string;
  to: string;
}

const EMPTY: Filters = { actor: "", action: "", tenant: "", from: "", to: "" };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const diffText = (diff: Record<string, unknown>) => {
  const s = JSON.stringify(diff);
  return s === "{}" ? "—" : s.length > 160 ? `${s.slice(0, 157)}…` : s;
};

/** Platform audit trail: who did what, on which tenant, when. Filterable and paginated. */
export function AuditPage() {
  const [draft, setDraft] = useState<Filters>(EMPTY);
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [page, setPage] = useState(1);
  useEffect(() => {
    const t = setTimeout(() => {
      setFilters(draft);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [draft]);
  const tenantId = UUID_RE.test(filters.tenant.trim()) ? filters.tenant.trim() : undefined;
  const state = useAsync(
    () =>
      platformApi.audit({
        ...(filters.actor.trim() ? { actor: filters.actor.trim() } : {}),
        ...(filters.action ? { action: filters.action } : {}),
        ...(tenantId ? { tenantId } : {}),
        ...(filters.from ? { from: filters.from } : {}),
        ...(filters.to ? { to: filters.to } : {}),
        page,
      }),
    [filters, page],
  );
  const data = state.data;
  const pageCount = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const set = (k: keyof Filters) => (e: { target: { value: string } }) => setDraft((d) => ({ ...d, [k]: e.target.value }));
  return (
    <>
      <PageHeader title="Registro de actividad" subtitle="Acciones de los administradores de la plataforma." />
      <div className="mb-3 flex flex-wrap gap-2">
        <input aria-label="Administrador" placeholder="Email del administrador" value={draft.actor} onChange={set("actor")} className={`${fieldClass} min-w-0 flex-1 sm:max-w-[220px]`} />
        <select aria-label="Acción" value={draft.action} onChange={set("action")} className={fieldClass}>
          <option value="">Todas las acciones</option>
          {Object.entries(AUDIT_ACTION_LABELS).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
        <input aria-label="ID de empresa" placeholder="ID de empresa" value={draft.tenant} onChange={set("tenant")} className={`${fieldClass} min-w-0 sm:max-w-[200px]`} />
        <input type="date" aria-label="Desde" value={draft.from} onChange={set("from")} className={fieldClass} />
        <input type="date" aria-label="Hasta" value={draft.to} onChange={set("to")} className={fieldClass} />
      </div>
      <Loading state={state}>
        {!data || data.items.length === 0 ? (
          <p className="rounded-[16px] bg-white p-6 text-center text-sm text-muted">No hay eventos con esos filtros.</p>
        ) : (
          <>
            <Table head={["Fecha", "Administrador", "Acción", "Empresa", "Detalle"]}>
              {data.items.map((e) => (
                <tr key={e.id}>
                  <td className={`${td} whitespace-nowrap`}>{formatDateTime(e.createdAt)}</td>
                  <td className={td}>{e.actorEmail ?? "—"}</td>
                  <td className={td}>{AUDIT_ACTION_LABELS[e.action] ?? e.action}</td>
                  <td className={td}>
                    {e.tenantId ? (
                      <Link href={`/app/admin/tenants/${e.tenantId}`} className="hover:underline">{e.tenantName ?? e.tenantId}</Link>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className={`${td} font-mono text-[11px] break-all text-muted`}>{diffText(e.diff)}</td>
                </tr>
              ))}
            </Table>
            <nav aria-label="Paginación" className="mt-3 flex items-center justify-between gap-3 text-[13px] text-muted">
              <span>
                {formatNumber(data.total)} eventos · página {data.page} de {pageCount}
              </span>
              <div className="flex gap-1.5">
                <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Anterior</Button>
                <Button size="sm" variant="outline" disabled={page >= pageCount} onClick={() => setPage((p) => p + 1)}>Siguiente</Button>
              </div>
            </nav>
          </>
        )}
      </Loading>
    </>
  );
}
