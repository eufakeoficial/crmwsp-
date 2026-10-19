"use client";

import type { TenantMember } from "@crmwsp/contracts";
import { useEffect, useState } from "react";
import { EmptyState, PageHeader } from "@/components/app/EmptyState";
import { ROLE_LABELS } from "@/components/app/roles";
import { useSession } from "@/components/app/SessionProvider";
import { Alert, Card } from "@/components/ui";
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
      <PageHeader title="Equipo" />
      {!tenantId ? (
        <EmptyState title="Sin empresa activa">Elige una empresa para ver su equipo.</EmptyState>
      ) : state.status === "loading" ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400" aria-busy="true">Cargando equipo…</p>
      ) : state.status === "forbidden" ? (
        <EmptyState title="Sin acceso al equipo">
          Solo los propietarios y administradores pueden ver la lista de miembros.
        </EmptyState>
      ) : state.status === "error" ? (
        <Alert>{state.message}</Alert>
      ) : state.members.length === 0 ? (
        <EmptyState title="Sin miembros" />
      ) : (
        <Card className="p-0">
          <ul className="divide-y divide-zinc-200 dark:divide-zinc-800" aria-label="Miembros del equipo">
            {state.members.map((m) => (
              <li key={m.userId} className="flex items-center justify-between gap-4 px-4 py-3" data-testid="member">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{m.name ?? m.email}</p>
                  <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">{m.email}</p>
                </div>
                <span className="shrink-0 rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs font-medium dark:bg-zinc-800">
                  {ROLE_LABELS[m.role]}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
