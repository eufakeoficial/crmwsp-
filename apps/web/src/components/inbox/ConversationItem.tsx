import type { Conversation, InboxConversation } from "@crmwsp/contracts";
import { Avatar } from "@/components/ui";
import { cn } from "@/lib/cn";
import { ATTACHMENT_LABELS, activityOf } from "@/lib/inbox-state";
import { compactRelative } from "./inbox-meta";

export interface TagMeta {
  emoji: string | null;
  color: string | null;
}

/** Chat list row. Accepts the legacy Conversation too (design showcase); inbox fields are optional. */
export function ConversationItem({
  conversation: c,
  selected,
  onSelect,
  checked,
  onCheck,
  tagMeta,
}: {
  conversation: Conversation | InboxConversation;
  selected: boolean;
  onSelect: () => void;
  /** Bulk-selection checkbox; omitted = no checkbox. */
  checked?: boolean;
  onCheck?: () => void;
  tagMeta?: ReadonlyMap<string, TagMeta>;
}) {
  const inbox = "unread" in c ? c : null;
  const title = c.contact.name ?? "Contacto desconocido";
  const last = c.lastMessage;
  const unread = inbox ? inbox.unread : c.unreadCount > 0;
  const preview = last ? `${last.direction === "outbound" ? "Tú: " : ""}${last.preview ?? ATTACHMENT_LABELS[last.type]}` : "Sin mensajes";
  const tagEmojis = (inbox?.contactTags ?? []).map((t) => ({ name: t, emoji: tagMeta?.get(t)?.emoji ?? "🏷" }));
  const assigneeName = c.assignee ? (c.assignee.name ?? c.assignee.email) : null;
  return (
    <li className={cn("flex min-h-[88px] items-stretch border-b border-line pl-3", selected ? "bg-lime-soft" : "hover:bg-paper-2")}>
      {onCheck ? (
        <input
          type="checkbox"
          aria-label={`Seleccionar ${title}`}
          checked={checked === true}
          onChange={onCheck}
          className="my-auto size-4 flex-none cursor-pointer accent-ink"
        />
      ) : null}
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? "true" : undefined}
        data-testid="conversation-item"
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 bg-transparent px-3 py-3 text-left"
      >
        <Avatar name={c.contact.name ?? "?"} round className="size-11 text-[15px]" />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex items-center gap-2">
            <b className={cn("min-w-0 flex-1 truncate text-[15px]", unread ? "font-extrabold" : "font-semibold")}>{title}</b>
            {unread ? <span data-testid="unread-badge" role="img" aria-label="Sin leer" className="size-2.5 flex-none rounded-full bg-focus" /> : null}
            <time dateTime={activityOf(c)} className="flex-none text-xs text-muted">{compactRelative(activityOf(c))}</time>
          </span>
          <span className={cn("block truncate text-[13px]", unread ? "font-bold text-ink" : "text-muted")}>{preview}</span>
          {tagEmojis.length > 0 || assigneeName ? (
            <span className="flex items-center gap-1 text-xs text-muted">
              <span className="flex min-w-0 flex-1 gap-0.5 truncate">
                {tagEmojis.slice(0, 6).map((t) => (
                  <span key={t.name} title={t.name} aria-label={`Etiqueta ${t.name}`}>{t.emoji}</span>
                ))}
              </span>
              {assigneeName ? (
                <span title={`Asignada a ${assigneeName}`} className="flex-none">
                  <Avatar name={assigneeName} size="sm" round className="size-5 text-[9px]" />
                  <span className="sr-only">Asignada a {assigneeName}</span>
                </span>
              ) : null}
            </span>
          ) : null}
        </span>
      </button>
    </li>
  );
}
