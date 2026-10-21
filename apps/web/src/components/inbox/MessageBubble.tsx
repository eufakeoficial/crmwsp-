import { REACTION_EMOJIS, type Message, type ReactionEmoji } from "@crmwsp/contracts";
import { AlertCircle, Bot, Check, CheckCheck, Clock, Paperclip, SmilePlus } from "lucide-react";
import { Badge } from "@/components/ui";
import { cn } from "@/lib/cn";
import { formatDateTime, formatTime } from "@/lib/format";
import { AttachmentView, attachmentKind } from "./AttachmentView";
import { ATTACHMENT_LABELS, deliveryErrorText } from "@/lib/inbox-state";

const STATUS_TEXT: Record<Message["status"], string> = {
  received: "Recibido",
  queued: "En cola",
  sent: "Enviado",
  delivered: "Entregado",
  read: "Leído",
  failed: "Fallido",
};

function StatusIcon({ message }: { message: Message }) {
  const label = message.status === "failed" ? `Fallido: ${deliveryErrorText(message.error)}` : STATUS_TEXT[message.status];
  const common = "size-3.5 flex-none";
  let icon;
  switch (message.status) {
    case "queued":
      icon = <Clock aria-hidden className={common} />;
      break;
    case "sent":
      icon = <Check aria-hidden className={common} />;
      break;
    case "delivered":
      icon = <CheckCheck aria-hidden className={common} />;
      break;
    case "read":
      icon = <CheckCheck aria-hidden className={cn(common, "text-lime")} />;
      break;
    case "failed":
      icon = <AlertCircle aria-hidden className={cn(common, "text-alert")} />;
      break;
    default:
      return null;
  }
  return (
    <span title={label} data-status={message.status} className="inline-flex items-center">
      {icon}
      <span className="sr-only">{label}</span>
    </span>
  );
}

/** Small emoji badge on the bubble's bottom corner (Messenger style). */
function ReactionBadge({ message }: { message: Message }) {
  if (!message.reaction) return null;
  const who = message.reactionBy === "contact" ? "el cliente" : message.reactionBy === "ai" ? "la IA" : "un agente";
  return (
    <span
      title={`Reacción de ${who}`}
      data-reaction={message.reaction}
      className={cn(
        "absolute -bottom-3 flex h-6 min-w-6 items-center justify-center rounded-full border border-line bg-white px-1 text-sm leading-none shadow-sm",
        message.direction === "outbound" ? "left-2" : "right-2",
      )}
    >
      <span aria-hidden>{message.reaction}</span>
      <span className="sr-only">Reacción de {who}: {message.reaction}</span>
    </span>
  );
}

/** Hover/focus menu to react to a contact message with the allowed emoji set. */
function ReactionMenu({ message, onReact }: { message: Message; onReact: (messageId: string, emoji: ReactionEmoji | null) => Promise<void> }) {
  return (
    <div
      role="group"
      aria-label="Reaccionar al mensaje"
      className="invisible absolute -top-4 right-0 z-10 flex gap-0.5 rounded-full border border-line bg-white px-1.5 py-0.5 shadow-sm group-focus-within:visible group-hover:visible"
    >
      <SmilePlus aria-hidden className="size-4 self-center text-muted" />
      {REACTION_EMOJIS.map((emoji) => (
        <button
          key={emoji}
          type="button"
          aria-label={`Reaccionar con ${emoji}`}
          aria-pressed={message.reaction === emoji}
          onClick={() => void onReact(message.id, message.reaction === emoji ? null : emoji)}
          className={cn("rounded-full px-1 text-base leading-none hover:bg-line/40", message.reaction === emoji && "bg-line/60")}
        >
          {emoji}
        </button>
      ))}
    </div>
  );
}

export function MessageBubble({
  message,
  onReact,
}: {
  message: Message;
  onReact?: (messageId: string, emoji: ReactionEmoji | null) => Promise<void>;
}) {
  const out = message.direction === "outbound";
  const viewable = message.attachments.filter((a) => attachmentKind(message.type, a.mimeType) !== "other");
  const rest = message.attachments.filter((a) => attachmentKind(message.type, a.mimeType) === "other");
  const chips = rest.length
    ? rest.map((a) => `${ATTACHMENT_LABELS[message.type]}${a.mimeType ? ` · ${a.mimeType}` : ""}`)
    : viewable.length === 0 && message.type !== "text" && message.type !== "template"
      ? [ATTACHMENT_LABELS[message.type]]
      : [];
  return (
    <div
      className={cn("group relative flex flex-col gap-1", out ? "items-end" : "items-start", message.reaction && "mb-3")}
      data-direction={message.direction}
    >
      {!out && onReact && message.status !== "failed" ? <ReactionMenu message={message} onReact={onReact} /> : null}
      <div
        className={cn(
          "relative max-w-[min(520px,85%)] rounded-[20px] px-3.5 py-2 text-[15px] break-words",
          out ? "rounded-br-md bg-ink text-white" : "rounded-bl-md border border-line bg-white text-ink",
        )}
      >
        {viewable.length ? (
          <div className="mb-1 flex flex-col gap-2">
            {viewable.map((a) => (
              <AttachmentView key={a.id} messageType={message.type} attachment={a} />
            ))}
          </div>
        ) : null}
        {chips.length ? (
          <div className="mb-1 flex flex-wrap gap-1">
            {chips.map((c, i) => (
              <Badge key={i} tone="neutral" className="text-ink"><Paperclip aria-hidden className="size-3" />{c}</Badge>
            ))}
          </div>
        ) : null}
        {message.body ? <p className="m-0 whitespace-pre-wrap">{message.body}</p> : null}
        <div className={cn("mt-0.5 flex items-center justify-end gap-1 text-[11px]", out ? "text-subtle" : "text-muted")}>
          {message.author === "ai" ? (
            <span title="Mensaje escrito por la IA" className="inline-flex items-center gap-0.5">
              <Bot aria-hidden className="size-3.5" />
              <span className="sr-only">Escrito por la IA</span>
            </span>
          ) : null}
          <time dateTime={message.createdAt} title={formatDateTime(message.createdAt)}>{formatTime(message.createdAt)}</time>
          {out ? <StatusIcon message={message} /> : null}
        </div>
        <ReactionBadge message={message} />
      </div>
      {out && message.status === "failed" ? (
        <p role="status" className="m-0 max-w-[85%] px-1 text-xs font-semibold text-danger">
          No se pudo enviar: {deliveryErrorText(message.error)}
        </p>
      ) : null}
    </div>
  );
}
