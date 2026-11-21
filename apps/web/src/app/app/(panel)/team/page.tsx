"use client";

import type { MembershipRole, TeamInvitation, TenantMember } from "@crmwsp/contracts";
import { useCallback, useEffect, useState } from "react";
import { SetupRequiredHint, useSetupMode } from "@/components/app/billing/SetupGate";
import { EmptyState, PageHeader } from "@/components/app/EmptyState";
import { ROLE_LABELS } from "@/components/app/roles";
import { useSession } from "@/components/app/SessionProvider";
import { InviteDialog, SELECT_CLASS, grantableRoles } from "@/components/team/InviteDialog";
import { PendingInvites } from "@/components/team/PendingInvites";
import { Alert, Avatar, Badge, Button, Card, Modal } from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { errorMessage } from "@/lib/messages";
import { teamApi, teamErrorMessage } from "@/lib/team-api";

type State =
  | { status: "loading" }
  | { status: "forbidden" }
  | { status: "error"; message: string }
  | { status: "ready"; members: TenantMember[]; invitations: TeamInvitation[] };

export default function TeamPage() {
  const { tenant, me } = useSession();
  const tenantId = tenant?.id;
  const actor = tenant?.role;
  const [state, setState] = useState<State>({ status: "loading" });
  const [inviting, setInviting] = useState(false);
  const inSetup = useSetupMode();
  const [removing, setRemoving] = useState<TenantMember | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string>();
  const [notice, setNotice] = useState<string>();

  const load = useCallback(async () => {
    try {
      const [members, invitations] = await Promise.all([api.members(), teamApi.invitations()]);
      setState({ status: "ready", members: members.items, invitations: invitations.items });
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) setState({ status: "forbidden" });
      else setState({ status: "error", message: errorMessage(err) });
    }
  }, []);

  useEffect(() => {
    if (!tenantId) return;
    setState({ status: "loading" });
    void load();
  }, [tenantId, load]);

  async function act(id: string, fn: () => Promise<unknown>, done?: string) {
    setBusyId(id);
    setActionError(undefined);
    setNotice(undefined);
    try {
      await fn();
      if (done) setNotice(done);
      await load();
    } catch (err) {
      setActionError(teamErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  const ownerCount = state.status === "ready" ? state.members.filter((m) => m.role === "owner").length : 0;
  const canEdit = (m: TenantMember) => (actor === "owner" ? !(m.role === "owner" && ownerCount <= 1) : actor === "admin" && m.role !== "owner" && m.role !== "admin");

  return (
    <>
      <PageHeader title="Equipo" subtitle="Invita a quienes atienden a tus clientes y define qué puede hacer cada persona." />
      {state.status === "ready" ? (
        <div className="mb-3 flex flex-col items-end gap-1">
          <Button size="sm" variant="accent" disabled={inSetup} onClick={() => setInviting(true)}>
            Invitar miembro
          </Button>
          {inSetup ? <SetupRequiredHint /> : null}
        </div>
      ) : null}
      <Alert>{actionError}</Alert>
      {notice ? <p className="m-0 mb-2 text-sm text-muted" role="status">{notice}</p> : null}
      {!tenantId ? (
        <EmptyState title="Sin empresa activa">Elige una empresa para ver su equipo.</EmptyState>
      ) : state.status === "loading" ? (
        <p className="text-sm text-muted" aria-busy="true">Cargando equipo…</p>
      ) : state.status === "forbidden" ? (
        <EmptyState title="Sin acceso al equipo">Solo los propietarios y administradores pueden ver la lista de miembros.</EmptyState>
      ) : state.status === "error" ? (
        <Alert>{state.message}</Alert>
      ) : (
        <>
          <Card className="p-0 sm:p-0">
            <ul className="divide-y divide-line" aria-label="Miembros del equipo">
              {state.members.map((m) => {
                const editable = canEdit(m);
                const options = grantableRoles(actor, true);
                return (
                  <li key={m.userId} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5" data-testid="member">
                    <div className="flex min-w-0 items-center gap-3">
                      <Avatar name={m.name ?? m.email} round />
                      <div className="min-w-0">
                        <p className="m-0 truncate text-sm font-bold">
                          {m.name ?? m.email}
                          {m.userId === me.user.id ? <span className="font-normal text-muted"> (tú)</span> : null}
                        </p>
                        <p className="m-0 truncate text-xs text-muted">{m.email}</p>
                      </div>
                    </div>
                    {editable ? (
                      <div className="flex items-center gap-2">
                        <select
                          aria-label={`Rol de ${m.name ?? m.email}`}
                          value={m.role}
                          disabled={busyId === m.userId}
                          onChange={(e) => void act(m.userId, () => teamApi.changeRole(m.userId, e.target.value as MembershipRole), "Rol actualizado.")}
                          className={SELECT_CLASS}
                        >
                          {(options.includes(m.role) ? options : [m.role, ...options]).map((r) => (
                            <option key={r} value={r}>
                              {ROLE_LABELS[r]}
                            </option>
                          ))}
                        </select>
                        <Button size="sm" variant="ghost" disabled={busyId === m.userId} onClick={() => setRemoving(m)}>
                          Quitar
                        </Button>
                      </div>
                    ) : (
                      <Badge>{ROLE_LABELS[m.role]}</Badge>
                    )}
                  </li>
                );
              })}
            </ul>
          </Card>
          <PendingInvites
            items={state.invitations}
            actor={actor}
            busyId={busyId}
            onResend={(id) => void act(id, () => teamApi.resend(id), "Invitación reenviada.")}
            onRevoke={(id) => void act(id, () => teamApi.revoke(id), "Invitación revocada.")}
          />
        </>
      )}
      {inviting ? (
        <InviteDialog
          actor={actor}
          onClose={() => setInviting(false)}
          onInvited={() => {
            setInviting(false);
            setNotice("Invitación enviada.");
            void load();
          }}
        />
      ) : null}
      {removing ? (
        <Modal
          title="Quitar miembro"
          onClose={() => setRemoving(null)}
          footer={
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setRemoving(null)}>
                Cancelar
              </Button>
              <Button
                size="sm"
                variant="accent"
                onClick={() => {
                  const m = removing;
                  setRemoving(null);
                  void act(m.userId, () => teamApi.remove(m.userId), "Miembro quitado.");
                }}
              >
                Quitar
              </Button>
            </div>
          }
        >
          <p className="m-0 text-sm">
            {removing.name ?? removing.email} perderá el acceso a esta empresa de inmediato.
          </p>
        </Modal>
      ) : null}
    </>
  );
}
