"use client";

import type { MembershipRole, TeamInvitation } from "@crmwsp/contracts";
import { ROLE_LABELS } from "@/components/app/roles";
import { Badge, Button, Card } from "@/components/ui";

const fmt = (iso: string) => new Date(iso).toLocaleDateString("es", { day: "numeric", month: "short" });

export function PendingInvites({
  items,
  actor,
  busyId,
  onResend,
  onRevoke,
}: {
  items: TeamInvitation[];
  actor: MembershipRole | undefined;
  busyId: string | null;
  onResend: (id: string) => void;
  onRevoke: (id: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <section className="mt-5" aria-label="Invitaciones pendientes">
      <h2 className="mb-2 text-sm font-bold">Invitaciones pendientes</h2>
      <Card className="p-0 sm:p-0">
        <ul className="divide-y divide-line">
          {items.map((i) => {
            const expired = new Date(i.expiresAt).getTime() <= Date.now();
            const manageable = actor === "owner" || (actor === "admin" && i.role !== "admin");
            return (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5" data-testid="invitation">
                <div className="min-w-0">
                  <p className="m-0 truncate text-sm font-bold">{i.email}</p>
                  <p className="m-0 text-xs text-muted">{expired ? "Caducada" : `Caduca el ${fmt(i.expiresAt)}`} · enviada el {fmt(i.lastSentAt)}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge>{ROLE_LABELS[i.role]}</Badge>
                  {manageable ? (
                    <>
                      <Button size="sm" variant="outline" disabled={busyId === i.id} onClick={() => onResend(i.id)}>
                        Reenviar
                      </Button>
                      <Button size="sm" variant="ghost" disabled={busyId === i.id} onClick={() => onRevoke(i.id)}>
                        Revocar
                      </Button>
                    </>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      </Card>
    </section>
  );
}
