import type { Conversation } from "@crmwsp/contracts";
import { Avatar, Badge } from "@/components/ui";
import { cn } from "@/lib/cn";
import { formatRelative } from "@/lib/format";
import { ATTACHMENT_LABELS, activityOf } from "@/lib/inbox-state";

export function ConversationItem({ conversation: c, selected, onSelect }: { conversation: Conversation; selected: boolean; onSelect: () => void }) {
  const title = c.contact.name ?? c.contact.phoneE164;
  const last = c.lastMessage;
  const preview = last ? `${last.direction === "outbound" ? "Tú: " : ""}${last.preview ?? ATTACHMENT_LABELS[last.type]}` : "Sin mensajes";
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? "true" : undefined}
        data-testid="conversation-item"
        className={cn(
          "flex w-full cursor-pointer items-start gap-3 rounded-2xl p-3 text-left transition",
          selected ? "bg-lime-soft" : "bg-transparent hover:bg-paper",
        )}
      >
        <Avatar name={title} round />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <b className={cn("min-w-0 flex-1 truncate text-[15px]", c.unreadCount > 0 && "font-extrabold")}>{title}</b>
            <time dateTime={activityOf(c)} className="flex-none text-xs text-muted">{formatRelative(activityOf(c))}</time>
          </span>
          <span className="flex items-center gap-2">
            <span className={cn("min-w-0 flex-1 truncate text-[13px]", c.unreadCount > 0 ? "font-bold text-ink" : "text-muted")}>{preview}</span>
            {c.unreadCount > 0 ? (
              <Badge tone="new" data-testid="unread-badge" aria-label={`${c.unreadCount} sin leer`}>{c.unreadCount}</Badge>
            ) : null}
          </span>
          <span className="mt-0.5 block truncate text-xs text-muted">
            {c.assignee ? `Asignada a ${c.assignee.name ?? c.assignee.email}` : "Sin asignar"}
          </span>
        </span>
      </button>
    </li>
  );
}
