"use client";

import type { InvitableRole, MembershipRole } from "@crmwsp/contracts";
import { type FormEvent, useState } from "react";
import { ROLE_LABELS } from "@/components/app/roles";
import { Alert, Button, Input, Label, Modal } from "@/components/ui";
import { teamApi, teamErrorMessage } from "@/lib/team-api";

export const SELECT_CLASS = "h-10 rounded-xl border-[1.5px] border-ink bg-white px-2.5 text-[14px] text-ink disabled:opacity-50";

/** Roles the actor may grant: only an owner grants admin (and owner, for existing members). */
export function grantableRoles(actor: MembershipRole | undefined, includeOwner = false): MembershipRole[] {
  if (actor === "owner") return includeOwner ? ["owner", "admin", "agent", "viewer"] : ["admin", "agent", "viewer"];
  if (actor === "admin") return ["agent", "viewer"];
  return [];
}

export function InviteDialog({ actor, onClose, onInvited }: { actor: MembershipRole | undefined; onClose: () => void; onInvited: () => void }) {
  const roles = grantableRoles(actor) as InvitableRole[];
  const [role, setRole] = useState<InvitableRole>(roles.includes("agent") ? "agent" : (roles[0] ?? "viewer"));
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const email = String(new FormData(e.currentTarget).get("email") ?? "");
    setBusy(true);
    setError(undefined);
    try {
      await teamApi.invite({ email, role });
      onInvited();
    } catch (err) {
      setError(teamErrorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Modal title="Invitar miembro" onClose={onClose}>
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <div className="space-y-1">
          <Label htmlFor="invite-email">Correo electrónico</Label>
          <Input id="invite-email" name="email" type="email" autoComplete="off" required data-autofocus />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="invite-role">Rol</Label>
          <select id="invite-role" value={role} onChange={(e) => setRole(e.target.value as InvitableRole)} className={SELECT_CLASS}>
            {roles.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        </div>
        <p className="m-0 text-xs text-muted">Enviaremos un enlace válido 7 días y de un solo uso. Las invitaciones pendientes ocupan un puesto del plan.</p>
        <Alert>{error}</Alert>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" variant="accent" size="sm" disabled={busy}>
            {busy ? "Enviando…" : "Enviar invitación"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
