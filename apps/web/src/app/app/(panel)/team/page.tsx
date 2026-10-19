"use client";

import type { TenantMember } from "@crmwsp/contracts";
import { useEffect, useState } from "react";
import { EmptyState, PageHeader } from "@/components/app/EmptyState";
import { ROLE_LABELS } from "@/components/app/roles";
import { useSession } from "@/components/app/SessionProvider";
import { Alert, Avatar, Badge, Card } from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { errorMessage } from "@/lib/messages";

type State =
  | { status: "loading" }
  | { status: "forbidden" }
  | { status: "error"; message: string }
  | { status: "ready"; members: TenantMember[] };

export default function TeamPage() {
  const { tenant } = useSession();
  const tenantId = tenant?.id;
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;
    setState({ status: "loading" });
    api
      .members()
      .then((res) => !cancelled && setState({ status: "ready", members: res.items }))
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 403) setState({ status: "forbidden" });
        else setState({ status: "error", message: errorMessage(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  return (
    <>
      <PageHeader title="Equipo" subtitle="Las personas con acceso a tu empresa." />
      {!tenantId ? (
        <EmptyState title="Sin empresa activa">Elige una empresa para ver su equipo.</EmptyState>
      ) : state.status === "loading" ? (
        <p className="text-sm text-muted" aria-busy="true">Cargando equipo…</p>
      ) : state.status === "forbidden" ? (
        <EmptyState title="Sin acceso al equipo">
          Solo los propietarios y administradores pueden ver la lista de miembros.
        </EmptyState>
      ) : state.status === "error" ? (
        <Alert>{state.message}</Alert>
      ) : state.members.length === 0 ? (
        <EmptyState title="Sin miembros" />
      ) : (
        <Card className="p-0 sm:p-0">
          <ul className="divide-y divide-line" aria-label="Miembros del equipo">
            {state.members.map((m) => (
              <li key={m.userId} className="flex items-center justify-between gap-4 px-4 py-3" data-testid="member">
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar name={m.name ?? m.email} round />
                  <div className="min-w-0">
                    <p className="m-0 truncate text-sm font-bold">{m.name ?? m.email}</p>
                    <p className="m-0 truncate text-xs text-muted">{m.email}</p>
                  </div>
                </div>
                <Badge>{ROLE_LABELS[m.role]}</Badge>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
