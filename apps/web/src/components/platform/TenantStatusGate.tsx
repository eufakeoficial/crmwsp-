"use client";

import { Clock, LogOut, ShieldAlert } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useSession } from "@/components/app/SessionProvider";
import { Button, Card } from "@/components/ui";

const COPY = {
  pending_approval: {
    title: "Tu cuenta está en revisión",
    body: "Estamos revisando tu alta. Te avisaremos por correo en cuanto esté aprobada; mientras tanto no puedes conectar canales ni usar la IA.",
  },
  rejected: {
    title: "Tu solicitud no fue aprobada",
    body: "Revisamos tu cuenta y no pudimos aprobarla. Si crees que es un error, responde al correo que te enviamos.",
  },
  suspended: {
    title: "Tu cuenta está suspendida",
    body: "Mientras siga suspendida no se procesan mensajes ni se usa la IA. Responde al correo que te enviamos para regularizarla.",
  },
} as const;

/** Replaces the panel with a status screen while the active tenant is not `active` (ADR 0011). */
export function TenantStatusGate({ children }: { children: ReactNode }) {
  const { me, tenant, selectTenant, logout } = useSession();
  const [leaving, setLeaving] = useState(false);
  const status = tenant?.status;
  if (!status || status === "active") return <>{children}</>;
  const copy = COPY[status];
  const others = me.tenants.filter((t) => t.id !== tenant.id && (t.status ?? "active") === "active");
  const Icon = status === "pending_approval" ? Clock : ShieldAlert;
  return (
    <main className="grid min-h-dvh place-items-center bg-paper p-4">
      <Card className="flex w-full max-w-md flex-col items-center gap-3 p-6 text-center" data-testid="tenant-status-gate">
        <span aria-hidden className="grid size-14 place-items-center rounded-full bg-lime text-ink">
          <Icon className="size-6" />
        </span>
        <h1 className="m-0 text-[22px] font-extrabold tracking-[-0.02em]">{copy.title}</h1>
        <p className="m-0 text-sm text-muted">{copy.body}</p>
        <p className="m-0 text-[13px] font-bold">{tenant.name}</p>
        {others.length > 0 ? (
          <div className="flex flex-wrap justify-center gap-2">
            {others.map((t) => (
              <Button key={t.id} variant="outline" size="sm" onClick={() => selectTenant(t.id)}>
                Ir a {t.name}
              </Button>
            ))}
          </div>
        ) : null}
        <Button
          variant="ghost"
          size="sm"
          disabled={leaving}
          onClick={() => {
            setLeaving(true);
            void logout();
          }}
        >
          <LogOut aria-hidden className="mr-1.5 inline size-4" />
          Cerrar sesión
        </Button>
      </Card>
    </main>
  );
}
