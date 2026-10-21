import type { ConversationNote } from "@crmwsp/contracts";
import { StickyNote } from "lucide-react";
import { formatDateTime, formatTime } from "@/lib/format";

/** Internal note: yellow, centered, never sent to the contact. */
export function NoteBubble({ note }: { note: ConversationNote }) {
  const author = note.author ? (note.author.name ?? note.author.email) : "Equipo";
  return (
    <div className="flex justify-center" data-testid="note-bubble">
      <div className="w-full max-w-[min(520px,92%)] rounded-2xl border border-gold bg-gold-soft px-3.5 py-2 text-[14px] text-ink">
        <p className="m-0 mb-0.5 flex items-center gap-1.5 text-[11px] font-extrabold tracking-wide text-warning uppercase">
          <StickyNote aria-hidden className="size-3.5" /> Nota interna · {author}
        </p>
        <p className="m-0 whitespace-pre-wrap break-words">{note.body}</p>
        <p className="m-0 mt-0.5 text-right text-[11px] text-warning">
          <time dateTime={note.createdAt} title={formatDateTime(note.createdAt)}>{formatTime(note.createdAt)}</time>
        </p>
      </div>
    </div>
  );
}
