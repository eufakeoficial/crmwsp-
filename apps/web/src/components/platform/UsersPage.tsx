"use client";

import type { PlatformUser } from "@crmwsp/contracts";
import Link from "next/link";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/app/EmptyState";
import { Button, SidePanel } from "@/components/ui";
import { formatDate, formatDateTime, formatNumber } from "@/lib/format";
import { ROLE_LABELS, platformApi, platformErrorMessage } from "@/lib/platform-api";
import { Loading, Table, fieldClass, td, useAsync } from "./shared";

/** All users across tenants (read-only); the drawer can revoke a user's sessions (audited). */
export function UsersPage() {
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<PlatformUser | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);
  const state = useAsync(() => platformApi.users(query ? { q: query } : {}), [query]);
  const items = state.data?.items ?? [];
  return (
    <>
      <PageHeader title="Usuarios" subtitle="Todas las personas con cuenta, en todas las empresas. Solo lectura." />
      <div className="mb-3 flex flex-wrap gap-2">
        <input aria-label="Buscar" placeholder="Buscar por nombre o email" value={q} onChange={(e) => setQ(e.target.value)} className={`${fieldClass} min-w-0 flex-1 sm:max-w-xs`} />
      </div>
      <Loading state={state}>
        {items.length === 0 ? (
          <p className="rounded-[16px] bg-white p-6 text-center text-sm text-muted">Sin resultados.</p>
        ) : (
          <Table head={["Usuario", "Empresas", "Alta", "Último acceso", "Sesiones"]}>
            {items.map((u) => (
              <tr key={u.id}>
                <td className={td}>
                  <button type="button" onClick={() => setSelected(u)} className="cursor-pointer text-left font-bold hover:underline">
                    {u.name ?? u.email}
                  </button>
                  <span className="block text-[11px] text-muted">
                    {u.email}
                    {u.isPlatformAdmin ? <span className="ml-1.5 rounded-full bg-lime px-1.5 py-0.5 font-bold text-ink">Admin plataforma</span> : null}
                  </span>
                </td>
                <td className={td}>{u.tenants.length === 0 ? "—" : u.tenants.map((t) => `${t.name} (${ROLE_LABELS[t.role] ?? t.role})`).join(", ")}</td>
                <td className={td}>{formatDate(u.createdAt)}</td>
                <td className={td}>{u.lastLoginAt ? formatDateTime(u.lastLoginAt) : "—"}</td>
                <td className={td}>{formatNumber(u.activeSessions)}</td>
              </tr>
            ))}
          </Table>
        )}
      </Loading>
      {selected ? (
        <UserDrawer
          user={selected}
          onClose={() => setSelected(null)}
          onChanged={(u) => {
            setSelected(u);
            state.reload();
          }}
        />
      ) : null}
    </>
  );
}

function UserDrawer({ user, onClose, onChanged }: { user: PlatformUser; onClose: () => void; onChanged: (u: PlatformUser) => void }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const revoke = async () => {
    if (!window.confirm(`¿Cerrar todas las sesiones de ${user.email}? Tendrá que volver a iniciar sesión.`)) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await platformApi.revokeSessions(user.id);
      setMsg(r.revoked === 1 ? "Se cerró 1 sesión." : `Se cerraron ${r.revoked} sesiones.`);
      onChanged(await platformApi.user(user.id));
    } catch (err) {
      setMsg(platformErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <SidePanel
      title={user.name ?? user.email}
      onClose={onClose}
      fields={[
        { label: "Email", value: user.email },
        { label: "Alta", value: formatDate(user.createdAt) },
        { label: "Último acceso", value: user.lastLoginAt ? formatDateTime(user.lastLoginAt) : "—" },
        { label: "Sesiones activas", value: formatNumber(user.activeSessions) },
        { label: "Admin de plataforma", value: user.isPlatformAdmin ? "Sí" : "No" },
        {
          label: "Empresas",
          value:
            user.tenants.length === 0 ? (
              "—"
            ) : (
              <span className="flex flex-col items-end gap-0.5">
                {user.tenants.map((t) => (
                  <Link key={t.tenantId} href={`/app/admin/tenants/${t.tenantId}`} className="hover:underline">
                    {t.name} · {ROLE_LABELS[t.role] ?? t.role}
                  </Link>
                ))}
              </span>
            ),
        },
      ]}
      {...(msg ? { footnote: msg } : {})}
      actions={
        <Button size="sm" variant="outline" disabled={busy || user.activeSessions === 0} onClick={() => void revoke()}>
          Revocar sesiones
        </Button>
      }
    />
  );
}
