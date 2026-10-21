"use client";

import type { InboxCounts, TagDto } from "@crmwsp/contracts";
import { AlarmClock, ChevronDown, ChevronRight, ChevronsLeft, ChevronsRight, CircleCheck, Inbox, MessageSquare, Plus, UserCheck, UserX } from "lucide-react";
import { type FormEvent, useState } from "react";
import { cn } from "@/lib/cn";
import { type FolderId, TAG_COLORS, folderCount } from "./inbox-meta";

const FOLDERS: { id: FolderId; label: string; icon: typeof Inbox }[] = [
  { id: "all", label: "Todos los chats", icon: Inbox },
  { id: "open", label: "Abiertos", icon: MessageSquare },
  { id: "closed", label: "Cerrados", icon: CircleCheck },
  { id: "mine", label: "Asignados a mí", icon: UserCheck },
  { id: "unassigned", label: "Sin asignar", icon: UserX },
  { id: "reminders", label: "Recordatorios", icon: AlarmClock },
];

function Count({ n, strong }: { n: number | null; strong?: boolean }) {
  if (n === null || n === 0) return null;
  return (
    <span className={cn("ml-auto flex-none text-[12px] tabular-nums", strong ? "rounded-full bg-focus px-1.5 font-extrabold text-white" : "font-semibold text-muted")}>
      {n > 99 ? "99+" : n}
    </span>
  );
}

/** Left column: folders with badges, collapsible tag list and a collapse handle. */
export function FolderSidebar({
  folder,
  counts,
  tags,
  collapsed,
  onCollapse,
  onSelect,
  onCreateTag,
}: {
  folder: FolderId;
  counts: InboxCounts | null;
  tags: readonly TagDto[];
  collapsed: boolean;
  onCollapse: (next: boolean) => void;
  onSelect: (f: FolderId) => void;
  onCreateTag: (input: { name: string; emoji: string | null; color: string | null }) => Promise<boolean>;
}) {
  const [tagsOpen, setTagsOpen] = useState(true);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("");
  const [color, setColor] = useState<string>(TAG_COLORS[0]);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    const ok = await onCreateTag({ name: name.trim(), emoji: emoji.trim() || null, color });
    setBusy(false);
    if (ok) {
      setName("");
      setEmoji("");
      setCreating(false);
    }
  }

  return (
    <nav aria-label="Carpetas" className={cn("flex min-h-0 flex-col gap-0.5 overflow-y-auto bg-white py-2", collapsed ? "w-14 px-1.5" : "w-[260px] px-2")}>
      {FOLDERS.map((f) => {
        const n = folderCount(counts, f.id);
        const Icon = f.icon;
        return (
          <button
            key={f.id}
            type="button"
            onClick={() => onSelect(f.id)}
            aria-current={folder === f.id ? "true" : undefined}
            title={f.label}
            className={cn(
              "flex h-10 w-full cursor-pointer items-center gap-3 rounded-lg px-3 text-left text-[14px] text-ink",
              folder === f.id ? "bg-lime-soft font-extrabold" : "bg-transparent font-medium hover:bg-paper",
            )}
          >
            <Icon aria-hidden className="size-[18px] flex-none" />
            {collapsed ? <span className="sr-only">{f.label}</span> : <span className="min-w-0 flex-1 truncate">{f.label}</span>}
            {collapsed ? null : <Count n={n} strong={f.id === "all" || f.id === "reminders"} />}
          </button>
        );
      })}
      {collapsed ? null : (
        <div className="mt-2 border-t border-line pt-2">
          <div className="flex items-center">
            <button
              type="button"
              aria-expanded={tagsOpen}
              onClick={() => setTagsOpen((v) => !v)}
              className="flex h-8 min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-lg bg-transparent px-3 text-[12px] font-extrabold tracking-wide text-muted uppercase hover:bg-paper"
            >
              {tagsOpen ? <ChevronDown aria-hidden className="size-4" /> : <ChevronRight aria-hidden className="size-4" />}
              Etiquetas
            </button>
            <button
              type="button"
              aria-label="Crear etiqueta"
              title="Crear etiqueta"
              onClick={() => {
                setTagsOpen(true);
                setCreating(true);
              }}
              className="grid size-8 flex-none cursor-pointer place-items-center rounded-lg bg-transparent text-muted hover:bg-paper hover:text-ink"
            >
              <Plus aria-hidden className="size-4" />
            </button>
          </div>
          {tagsOpen ? (
            <div className="mt-1 flex flex-col gap-0.5">
              {tags.map((t) => {
                const id: FolderId = `tag:${t.name}`;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => onSelect(id)}
                    aria-current={folder === id ? "true" : undefined}
                    className={cn(
                      "flex h-9 w-full cursor-pointer items-center gap-2 rounded-lg px-3 text-left text-[14px] text-ink",
                      folder === id ? "bg-lime-soft font-extrabold" : "bg-transparent font-medium hover:bg-paper",
                    )}
                  >
                    <span aria-hidden className="grid size-5 flex-none place-items-center rounded-full text-[12px]" style={t.color ? { backgroundColor: `${t.color}22` } : undefined}>
                      {t.emoji ?? "🏷"}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{t.name}</span>
                    <Count n={folderCount(counts, id)} />
                  </button>
                );
              })}
              {tags.length === 0 ? <p className="m-0 px-2.5 py-1 text-xs text-muted">Aún no hay etiquetas.</p> : null}
              {creating ? (
                <form onSubmit={submit} className="mt-1 flex flex-col gap-1.5 rounded-lg bg-paper p-2">
                  <div className="flex gap-1.5">
                    <input
                      aria-label="Emoji de la etiqueta"
                      value={emoji}
                      maxLength={8}
                      placeholder="🏷"
                      onChange={(e) => setEmoji(e.target.value)}
                      className="h-8 w-10 rounded-lg border border-line-2 bg-white text-center text-[14px]"
                    />
                    <input
                      aria-label="Nombre de la etiqueta"
                      value={name}
                      maxLength={64}
                      placeholder="Nombre"
                      onChange={(e) => setName(e.target.value)}
                      className="h-8 min-w-0 flex-1 rounded-lg border border-line-2 bg-white px-2 text-[13px]"
                    />
                  </div>
                  <div role="radiogroup" aria-label="Color" className="flex flex-wrap gap-1.5">
                    {TAG_COLORS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        role="radio"
                        aria-checked={color === c}
                        aria-label={`Color ${c}`}
                        onClick={() => setColor(c)}
                        style={{ backgroundColor: c }}
                        className={cn("size-5 cursor-pointer rounded-full", color === c && "ring-2 ring-ink ring-offset-1")}
                      />
                    ))}
                  </div>
                  <div className="flex gap-1.5">
                    <button type="submit" disabled={busy || !name.trim()} className="h-8 flex-1 cursor-pointer rounded-full bg-ink text-[12px] font-bold text-white disabled:opacity-50">Crear</button>
                    <button type="button" onClick={() => setCreating(false)} className="h-8 cursor-pointer rounded-full bg-white px-3 text-[12px] font-bold">Cancelar</button>
                  </div>
                </form>
              ) : (
                <button
                  type="button"
                  onClick={() => setCreating(true)}
                  className="flex h-9 w-full cursor-pointer items-center gap-2 rounded-lg bg-transparent px-3 text-left text-[13px] font-bold text-info hover:bg-paper"
                >
                  <Plus aria-hidden className="size-4" /> Crear etiqueta
                </button>
              )}
            </div>
          ) : null}
        </div>
      )}
      <button
        type="button"
        onClick={() => onCollapse(!collapsed)}
        aria-label={collapsed ? "Expandir carpetas" : "Contraer carpetas"}
        title={collapsed ? "Expandir carpetas" : "Contraer carpetas"}
        className={cn("mt-auto grid size-9 flex-none cursor-pointer place-items-center rounded-lg bg-transparent text-muted hover:bg-paper hover:text-ink", collapsed ? "mx-auto" : "ml-auto")}
      >
        {collapsed ? <ChevronsRight aria-hidden className="size-4" /> : <ChevronsLeft aria-hidden className="size-4" />}
      </button>
    </nav>
  );
}
