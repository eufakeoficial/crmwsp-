import type { Message } from "@crmwsp/contracts";
import { AlertCircle, Check, CheckCheck, Clock, Paperclip } from "lucide-react";
import { Badge } from "@/components/ui";
import { cn } from "@/lib/cn";
import { formatTime } from "@/lib/format";
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

export function MessageBubble({ message }: { message: Message }) {
  const out = message.direction === "outbound";
  const viewable = message.attachments.filter((a) => attachmentKind(message.type, a.mimeType) !== "other");
  const rest = message.attachments.filter((a) => attachmentKind(message.type, a.mimeType) === "other");
  const chips = rest.length
    ? rest.map((a) => `${ATTACHMENT_LABELS[message.type]}${a.mimeType ? ` · ${a.mimeType}` : ""}`)
    : viewable.length === 0 && message.type !== "text" && message.type !== "template"
      ? [ATTACHMENT_LABELS[message.type]]
      : [];
  return (
    <div className={cn("flex flex-col gap-1", out ? "items-end" : "items-start")} data-direction={message.direction}>
      <div
        className={cn(
          "max-w-[min(520px,85%)] rounded-[20px] px-3.5 py-2 text-[15px] break-words",
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
          <time dateTime={message.createdAt}>{formatTime(message.createdAt)}</time>
          {out ? <StatusIcon message={message} /> : null}
        </div>
      </div>
      {out && message.status === "failed" ? (
        <p role="status" className="m-0 max-w-[85%] px-1 text-xs font-semibold text-danger">
          No se pudo enviar: {deliveryErrorText(message.error)}
        </p>
      ) : null}
    </div>
  );
}
