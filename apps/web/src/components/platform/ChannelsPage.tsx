"use client";

import type { PlatformChannelStatus } from "@crmwsp/contracts";
import Link from "next/link";
import { useState } from "react";
import { PageHeader } from "@/components/app/EmptyState";
import { cn } from "@/lib/cn";
import { formatDate, formatDateTime, formatNumber } from "@/lib/format";
import { CHANNEL_STATUS_LABELS, platformApi } from "@/lib/platform-api";
import { Loading, Table, fieldClass, td, useAsync } from "./shared";

const STATUS_CLASSES: Record<PlatformChannelStatus, string> = {
  active: "bg-lime-soft text-ink",
  pending: "bg-amber-soft text-amber-ink",
  disabled: "bg-paper text-muted",
};

const PROVIDER_LABELS: Record<string, string> = { gupshup: "Gupshup", "360dialog": "360dialog" };

/** WhatsApp numbers connected through a BSP, across tenants. No credentials, number masked. */
export function ChannelsPage() {
  const [status, setStatus] = useState<PlatformChannelStatus | "">("");
  const state = useAsync(() => platformApi.channels(status ? { status } : {}), [status]);
  const items = state.data?.items ?? [];
  return (
    <>
      <PageHeader title="Canales BSP" subtitle="Números de WhatsApp conectados en todas las empresas. Sin credenciales; número enmascarado." />
      <div className="mb-3 flex flex-wrap gap-2">
        <select aria-label="Estado" value={status} onChange={(e) => setStatus(e.target.value as PlatformChannelStatus | "")} className={fieldClass}>
          <option value="">Todos los estados</option>
          {(Object.keys(CHANNEL_STATUS_LABELS) as PlatformChannelStatus[]).map((s) => (
            <option key={s} value={s}>
              {CHANNEL_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </div>
      <Loading state={state}>
        {items.length === 0 ? (
          <p className="rounded-[16px] bg-white p-6 text-center text-sm text-muted">No hay canales con ese filtro.</p>
        ) : (
          <Table head={["Empresa", "Proveedor", "Número", "Estado", "Alta", "Último entrante", "Último saliente", "Fallos (7 días)"]}>
            {items.map((c) => (
              <tr key={c.id}>
                <td className={td}>
                  <Link href={`/app/admin/tenants/${c.tenantId}`} className="font-bold hover:underline">{c.tenantName}</Link>
                </td>
                <td className={td}>{PROVIDER_LABELS[c.provider] ?? c.provider}</td>
                <td className={cn(td, "font-mono whitespace-nowrap")}>•••• {c.phoneLast4}</td>
                <td className={td}>
                  <span className={cn("inline-flex rounded-full px-2 py-0.5 text-[11px] font-bold whitespace-nowrap", STATUS_CLASSES[c.status])}>
                    {CHANNEL_STATUS_LABELS[c.status]}
                  </span>
                </td>
                <td className={td}>{formatDate(c.createdAt)}</td>
                <td className={td}>{c.lastInboundAt ? formatDateTime(c.lastInboundAt) : "—"}</td>
                <td className={td}>{c.lastOutboundAt ? formatDateTime(c.lastOutboundAt) : "—"}</td>
                <td className={cn(td, c.failedLast7d > 0 && "font-bold text-danger")}>{formatNumber(c.failedLast7d)}</td>
              </tr>
            ))}
          </Table>
        )}
      </Loading>
    </>
  );
}
