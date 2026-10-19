"use client";

import type { Conversation, ConversationStatus, TenantMember } from "@crmwsp/contracts";
import { ArrowLeft, PanelRight } from "lucide-react";
import { Avatar, Chip } from "@/components/ui";

const STATUSES: { value: ConversationStatus; label: string }[] = [
  { value: "open", label: "Abierta" },
  { value: "pending", label: "Pendiente" },
  { value: "resolved", label: "Resuelta" },
];

const SELECT = "h-9 min-w-0 max-w-full cursor-pointer rounded-full border-[1.5px] border-line-2 bg-white px-2.5 text-[13px] font-bold text-ink";

/**
 * Title, assignee selector and status chips. `members` is null when GET /tenant/members is
 * forbidden (agent role): then only "Asignarme a mí" / "Quitar asignación" are offered.
 */
export function ConversationHeader({
  conversation,
  members,
  meId,
  busy,
  onBack,
  onInfo,
  onAssign,
  onStatus,
}: {
  conversation: Conversation;
  members: readonly TenantMember[] | null;
  meId: string;
  busy: boolean;
  onBack: () => void;
  onInfo: () => void;
  onAssign: (userId: string | null) => void;
  onStatus: (status: ConversationStatus) => void;
}) {
  const { contact, assignee } = conversation;
  const title = contact.name ?? contact.phoneE164;
  const assignedId = assignee?.id ?? "";
  return (
    <header className="flex flex-col gap-2 border-b border-line bg-white p-3">
      <div className="flex items-center gap-2.5">
        <button type="button" onClick={onBack} aria-label="Volver a la lista" className="grid size-10 flex-none cursor-pointer place-items-center rounded-full bg-paper text-ink desk:hidden">
          <ArrowLeft aria-hidden className="size-5" />
        </button>
        <Avatar name={title} round />
        <div className="min-w-0 flex-1">
          <h2 className="m-0 truncate text-[16px] leading-tight font-extrabold">{title}</h2>
          <p className="m-0 truncate text-xs text-muted">{contact.name ? contact.phoneE164 : "Sin nombre"}</p>
        </div>
        <button type="button" onClick={onInfo} aria-label="Ver ficha del contacto" className="grid size-10 flex-none cursor-pointer place-items-center rounded-full bg-paper text-ink desk:hidden">
          <PanelRight aria-hidden className="size-5" />
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Estado de la conversación" className="flex gap-1.5">
          {STATUSES.map((s) => (
            <Chip key={s.value} active={conversation.status === s.value} disabled={busy || conversation.status === s.value} onClick={() => onStatus(s.value)}>
              {s.label}
            </Chip>
          ))}
        </div>
        {members ? (
          <select aria-label="Asignar a" className={SELECT} disabled={busy} value={assignedId} onChange={(e) => onAssign(e.target.value || null)}>
            <option value="">Sin asignar</option>
            {members.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.name ?? m.email}
                {m.userId === meId ? " (tú)" : ""}
              </option>
            ))}
          </select>
        ) : assignee?.id === meId ? (
          <Chip disabled={busy} onClick={() => onAssign(null)}>Quitar asignación</Chip>
        ) : (
          <Chip disabled={busy} onClick={() => onAssign(meId)}>Asignarme a mí</Chip>
        )}
        {assignee && assignee.id !== meId ? <span className="text-xs text-muted">Asignada a {assignee.name ?? assignee.email}</span> : null}
      </div>
    </header>
  );
}
