"use client";

import Link from "next/link";
import { PageHeader } from "@/components/app/EmptyState";
import { formatDate, formatNumber } from "@/lib/format";
import { TENANT_STATUS_LABELS, formatUsd, platformApi } from "@/lib/platform-api";
import { Loading, StatusPill, Table, td, useAsync } from "./shared";

const LIMIT_LABELS: Record<string, string> = {
  ai_messages: "Mensajes IA / mes",
  contacts: "Contactos",
  seats: "Usuarios",
  broadcast_sends: "Envíos masivos / mes",
  whatsapp_numbers: "Números WhatsApp",
};

const limitText = (v: number | null | undefined) => (v === null ? "Ilimitado" : v === undefined ? "—" : formatNumber(v));

/** Plan catalog (read-only, defined in code) + tenants per plan + per-tenant overrides. */
export function PlansPage() {
  const state = useAsync(() => platformApi.plans(), []);
  const plans = state.data?.plans ?? [];
  const overrides = state.data?.overrides ?? [];
  return (
    <>
      <PageHeader title="Planes" subtitle="Catálogo de planes (solo lectura) y empresas con límites personalizados." />
      <Loading state={state}>
        <div className="mb-5 grid gap-3 md:grid-cols-2">
          {plans.map((p) => (
            <section key={p.id} className="rounded-[16px] bg-white p-4">
              <div className="mb-2 flex items-baseline justify-between gap-2">
                <b className="text-[17px]">{p.name}</b>
                <span className="font-extrabold">{formatUsd(p.priceMonthlyUsd)} / mes</span>
              </div>
              <dl className="m-0 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-[13px]">
                {Object.keys(LIMIT_LABELS).map((k) => (
                  <div key={k} className="contents">
                    <dt className="text-muted">{LIMIT_LABELS[k]}</dt>
                    <dd className="m-0 text-right font-bold">{limitText(p.limits[k])}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-3 mb-0 border-t border-paper pt-2 text-[13px]">
                <b>{formatNumber(p.tenantCount)}</b> empresas
                {Object.entries(p.tenantsByStatus).length > 0 ? (
                  <span className="text-muted">
                    {" "}
                    ({Object.entries(p.tenantsByStatus)
                      .map(([s, n]) => `${formatNumber(n ?? 0)} ${TENANT_STATUS_LABELS[s as keyof typeof TENANT_STATUS_LABELS].toLowerCase()}`)
                      .join(", ")})
                  </span>
                ) : null}
              </p>
            </section>
          ))}
        </div>
        <h2 className="mb-2 text-[15px] font-extrabold">Límites personalizados</h2>
        {overrides.length === 0 ? (
          <p className="rounded-[16px] bg-white p-6 text-center text-sm text-muted">Ninguna empresa tiene límites personalizados.</p>
        ) : (
          <Table head={["Empresa", "Estado", "Plan", "Personalización", "Actualizado"]}>
            {overrides.map((o) => (
              <tr key={o.tenantId}>
                <td className={td}>
                  <Link href={`/app/admin/tenants/${o.tenantId}`} className="font-bold hover:underline">{o.name}</Link>
                  <span className="block text-[11px] text-muted">{o.slug}</span>
                </td>
                <td className={td}><StatusPill status={o.status} /></td>
                <td className={td}>{o.plan === "pro" ? "Pro" : "Start"}</td>
                <td className={td}>
                  {Object.entries(o.limitsOverride)
                    .map(([k, v]) => `${LIMIT_LABELS[k] ?? k}: ${limitText(v)}`)
                    .join(" · ")}
                </td>
                <td className={td}>{formatDate(o.updatedAt)}</td>
              </tr>
            ))}
          </Table>
        )}
        <p className="mt-2 text-[12px] text-muted">Para cambiar el plan o los límites de una empresa, abre su ficha.</p>
      </Loading>
    </>
  );
}
