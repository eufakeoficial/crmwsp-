"use client";

import type { InboxConversation, TagDto, TenantMember } from "@crmwsp/contracts";
import { AlarmClock, ArrowLeft, Bot, CircleCheck, MailOpen, PanelRight, RotateCcw, Tag } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Avatar } from "@/components/ui";
import { cn } from "@/lib/cn";
import { formatDateTime } from "@/lib/format";
import { REMINDER_PRESETS, TAG_COLORS, localInputToIso } from "./inbox-meta";
import { MenuItem, Popover } from "./Popover";

/** Inline text dropdown under the contact name: looks like a link, behaves like a select. */
const SELECT = "-ml-1 h-6 min-w-0 max-w-52 cursor-pointer rounded-md border-0 bg-transparent px-1 text-[13px] font-semibold text-muted hover:bg-paper hover:text-ink disabled:cursor-not-allowed disabled:opacity-50";
const ICON_BTN = "grid size-9 flex-none cursor-pointer place-items-center rounded-full bg-transparent text-ink hover:bg-paper disabled:cursor-not-allowed disabled:opacity-50";
const POP_ICON = "size-9 min-w-9 bg-transparent p-0 hover:bg-paper";

export const AUTO_ASSIGN = "__auto__";

export type ReminderInput = { preset: "20m" | "1h" | "6h" | "12h" } | { preset: "custom"; remindAt: string };

export const PAUSE_OPTIONS = [
  { label: "1 hora", minutes: 60 },
  { label: "24 horas", minutes: 1440 },
  { label: "7 días", minutes: 10_080 },
] as const;

/** ManyChat-style header: name, assignment selector and the action icons. */
export function ConversationHeader({
  conversation,
  members,
  meId,
  tags,
  busy,
  panelOpen,
  hideSystem,
  onBack,
  onTogglePanel,
  onHideSystem,
  onAssign,
  onToggleTag,
  onCreateTag,
  onRemind,
  onToggleStatus,
  onMarkUnread,
  onPause,
}: {
  conversation: InboxConversation;
  /** null when GET /tenant/members is forbidden (agent role): only "Yo" / "Sin asignar". */
  members: readonly TenantMember[] | null;
  meId: string;
  tags: readonly TagDto[];
  busy: boolean;
  panelOpen: boolean;
  hideSystem: boolean;
  onBack: () => void;
  onTogglePanel: () => void;
  onHideSystem: (hide: boolean) => void;
  /** "me", a user id, AUTO_ASSIGN or null. */
  onAssign: (assignee: string | null) => void;
  onToggleTag: (name: string, on: boolean) => void;
  onCreateTag: (input: { name: string; emoji: string | null; color: string | null }) => Promise<boolean>;
  onRemind: (input: ReminderInput) => void;
  onToggleStatus: () => void;
  onMarkUnread: () => void;
  /** minutes = null resumes now. */
  onPause: (minutes: number | null) => void;
}) {
  const { contact, assignee } = conversation;
  const title = contact.name ?? "Contacto desconocido";
  const closed = conversation.inboxStatus === "closed";
  const paused = conversation.automationsPausedUntil !== null && new Date(conversation.automationsPausedUntil) > new Date();
  const assignedId = assignee?.id === meId ? "me" : (assignee?.id ?? "");
  const hasTags = new Set(conversation.contactTags);
  return (
    <header className="flex flex-col border-b border-line bg-white">
      <div className="flex items-center gap-3 px-4 py-2.5">
        <button type="button" onClick={onBack} aria-label="Volver a la lista" className={cn(ICON_BTN, "desk:hidden")}>
          <ArrowLeft aria-hidden className="size-5" />
        </button>
        <Avatar name={contact.name ?? "?"} round />
        <div className="min-w-0 flex-1">
          <h2 className="m-0 truncate text-[16px] leading-tight font-extrabold">
            {title}
            {closed ? <span className="ml-2 rounded-full bg-paper px-2 py-0.5 align-middle text-[11px] font-bold text-muted">Cerrado</span> : null}
          </h2>
          <select
            aria-label="Asignar a"
            className={SELECT}
            disabled={busy}
            value={assignedId}
            onChange={(e) => onAssign(e.target.value === "" ? null : e.target.value)}
          >
            <option value="">No asignado</option>
            <option value="me">Yo</option>
            {(members ?? [])
              .filter((m) => m.userId !== meId && m.role !== "viewer")
              .map((m) => (
                <option key={m.userId} value={m.userId}>{m.name ?? m.email}</option>
              ))}
            {members ? <option value={AUTO_ASSIGN}>Asignar automáticamente</option> : null}
            {assignee && assignee.id !== meId && !members ? <option value={assignee.id}>{assignee.name ?? assignee.email}</option> : null}
          </select>
        </div>

        <Popover label="Etiquetas" align="right" triggerClassName={POP_ICON} trigger={<><Tag aria-hidden className="size-[18px]" />{conversation.contactTags.length ? <span className="text-[11px]">{conversation.contactTags.length}</span> : null}</>}>
          {() => <TagMenu tags={tags} has={hasTags} onToggle={onToggleTag} onCreate={onCreateTag} />}
        </Popover>

        <Popover label="Recuérdamelo" align="right" trigger={<AlarmClock aria-hidden className="size-[18px]" />} triggerClassName={cn(POP_ICON, conversation.nextReminderAt && "bg-lime-soft hover:bg-lime-soft")}>
          {(close) => <ReminderMenu next={conversation.nextReminderAt} onPick={(r) => { onRemind(r); close(); }} />}
        </Popover>

        <button type="button" className={ICON_BTN} disabled={busy} onClick={onToggleStatus} aria-label={closed ? "Reabrir conversación" : "Cerrar conversación"} title={closed ? "Reabrir" : "Cerrar"}>
          {closed ? <RotateCcw aria-hidden className="size-[18px]" /> : <CircleCheck aria-hidden className="size-[18px]" />}
        </button>
        <button type="button" className={ICON_BTN} disabled={busy} onClick={onMarkUnread} aria-label="Marcar como no leído" title="Marcar como no leído">
          <MailOpen aria-hidden className="size-[18px]" />
        </button>
        <Popover label="Pausar IA para este contacto" align="right" triggerClassName={cn(POP_ICON, paused && "bg-gold-soft hover:bg-gold-soft")} trigger={<Bot aria-hidden className="size-[18px]" />}>
          {(close) => (
            <div className="flex flex-col">
              <p className="m-0 px-2.5 pb-1 text-xs text-muted">
                {paused ? `Pausada hasta ${formatDateTime(conversation.automationsPausedUntil as string)}` : "Las automatizaciones y la IA responden a este contacto."}
              </p>
              {PAUSE_OPTIONS.map((o) => (
                <MenuItem key={o.minutes} onClick={() => { onPause(o.minutes); close(); }}>Pausar {o.label}</MenuItem>
              ))}
              {paused ? <MenuItem onClick={() => { onPause(null); close(); }}>Reanudar ahora</MenuItem> : null}
            </div>
          )}
        </Popover>
        <button type="button" onClick={onTogglePanel} aria-pressed={panelOpen} aria-label={panelOpen ? "Ocultar contacto" : "Mostrar contacto"} title={panelOpen ? "Ocultar contacto" : "Mostrar contacto"} className={cn(ICON_BTN, panelOpen && "bg-lime-soft hover:bg-lime-soft")}>
          <PanelRight aria-hidden className="size-[18px]" />
        </button>
      </div>
      <div className="flex items-center gap-3 px-4">
        <div role="tablist" aria-label="Canal">
          <button type="button" role="tab" aria-selected="true" className="h-11 cursor-pointer border-0 border-b-2 border-royal bg-transparent px-2 text-sm font-semibold text-ink">
            WhatsApp
          </button>
        </div>
        <label className="ml-auto flex cursor-pointer items-center gap-1.5 text-[12px] font-semibold text-muted">
          <input type="checkbox" checked={hideSystem} onChange={(e) => onHideSystem(e.target.checked)} className="size-4 cursor-pointer accent-ink" />
          Ocultar mensajes del sistema
        </label>
      </div>
    </header>
  );
}

function TagMenu({
  tags,
  has,
  onToggle,
  onCreate,
}: {
  tags: readonly TagDto[];
  has: ReadonlySet<string>;
  onToggle: (name: string, on: boolean) => void;
  onCreate: (input: { name: string; emoji: string | null; color: string | null }) => Promise<boolean>;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  async function create(e: FormEvent) {
    e.preventDefault();
    const n = name.trim();
    if (!n || busy) return;
    setBusy(true);
    const ok = await onCreate({ name: n, emoji: null, color: TAG_COLORS[tags.length % TAG_COLORS.length] ?? null });
    setBusy(false);
    if (ok) {
      onToggle(n, true);
      setName("");
    }
  }
  return (
    <div className="flex flex-col gap-1">
      {tags.map((t) => (
        <label key={t.id} className="flex cursor-pointer items-center gap-2 rounded-xl px-2.5 py-1.5 text-[13px] font-semibold hover:bg-paper">
          <input type="checkbox" checked={has.has(t.name)} onChange={(e) => onToggle(t.name, e.target.checked)} className="size-4 cursor-pointer accent-ink" />
          <span aria-hidden>{t.emoji ?? "🏷"}</span>
          <span className="min-w-0 flex-1 truncate">{t.name}</span>
        </label>
      ))}
      {tags.length === 0 ? <p className="m-0 px-2.5 text-xs text-muted">Aún no hay etiquetas.</p> : null}
      <form onSubmit={create} className="mt-1 flex gap-1.5 border-t border-line pt-2">
        <input
          aria-label="Nueva etiqueta"
          value={name}
          maxLength={64}
          placeholder="Nueva etiqueta"
          onChange={(e) => setName(e.target.value)}
          className="h-8 min-w-0 flex-1 rounded-lg border border-line-2 bg-white px-2 text-[13px]"
        />
        <button type="submit" disabled={busy || !name.trim()} className="h-9 cursor-pointer rounded-full bg-ink px-3 text-sm font-semibold text-white disabled:opacity-50">Crear</button>
      </form>
    </div>
  );
}

function ReminderMenu({ next, onPick }: { next: string | null; onPick: (r: ReminderInput) => void }) {
  const [custom, setCustom] = useState("");
  const iso = localInputToIso(custom);
  const future = iso !== null && new Date(iso) > new Date();
  return (
    <div className="flex flex-col gap-0.5">
      {next ? <p className="m-0 px-2.5 pb-1 text-xs text-muted">Próximo recordatorio: {formatDateTime(next)}</p> : null}
      {REMINDER_PRESETS.map((p) => (
        <MenuItem key={p.preset} onClick={() => onPick({ preset: p.preset })}>{p.label}</MenuItem>
      ))}
      <div className="mt-1 flex flex-col gap-1.5 border-t border-line px-1 pt-2">
        <label className="text-xs font-bold text-muted" htmlFor="reminder-custom">Fecha y hora</label>
        <input
          id="reminder-custom"
          type="datetime-local"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          className="h-9 rounded-lg border border-line-2 bg-white px-2 text-[13px]"
        />
        <button
          type="button"
          disabled={!future}
          onClick={() => iso && onPick({ preset: "custom", remindAt: iso })}
          className="h-9 cursor-pointer rounded-full bg-ink text-sm font-semibold text-white disabled:opacity-50"
        >
          Recordármelo
        </button>
      </div>
    </div>
  );
}
