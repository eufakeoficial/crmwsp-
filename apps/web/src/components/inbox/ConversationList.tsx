"use client";

import type { ContactFilter, InboxConversation, TagDto, TenantMember } from "@crmwsp/contracts";
import { CircleCheck, Tag, UserPlus } from "lucide-react";
import { Alert, Button } from "@/components/ui";
import { cn } from "@/lib/cn";
import { ConversationItem, type TagMeta } from "./ConversationItem";
import { InboxFilter, type FilterIds } from "./InboxFilter";
import { type StatusFilter, folderFixesStatus, type FolderId } from "./inbox-meta";
import { MenuItem, Popover } from "./Popover";

export interface ListControls {
  status: StatusFilter;
  unread: boolean;
  sort: "newest" | "oldest";
}

const SELECT = "h-9 cursor-pointer rounded-full border-[1.5px] border-line-2 bg-white px-2.5 text-[12px] font-bold text-ink disabled:cursor-not-allowed disabled:opacity-50";

export type BulkAction = { type: "close" } | { type: "assign"; assignee: string | null } | { type: "tag"; tag: string };

export function ConversationList({
  items,
  folder,
  controls,
  onControls,
  filter,
  onFilter,
  filterInfo,
  selectedId,
  checked,
  onCheck,
  onCheckAll,
  members,
  meId,
  tags,
  tagMeta,
  bulkBusy,
  onBulk,
  loading,
  loadingMore,
  hasMore,
  error,
  onSelect,
  onLoadMore,
}: {
  items: readonly InboxConversation[];
  folder: FolderId;
  controls: ListControls;
  onControls: (next: ListControls) => void;
  filter: ContactFilter;
  onFilter: (f: ContactFilter) => void;
  filterInfo: FilterIds;
  selectedId: string | null;
  checked: ReadonlySet<string>;
  onCheck: (id: string) => void;
  onCheckAll: (all: boolean) => void;
  members: readonly TenantMember[] | null;
  meId: string;
  tags: readonly TagDto[];
  tagMeta: ReadonlyMap<string, TagMeta>;
  bulkBusy: boolean;
  onBulk: (action: BulkAction) => void;
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  error: string | undefined;
  onSelect: (id: string) => void;
  onLoadMore: () => void;
}) {
  const allChecked = items.length > 0 && items.every((c) => checked.has(c.id));
  const some = checked.size > 0;
  const set = (patch: Partial<ListControls>) => onControls({ ...controls, ...patch });
  return (
    <section aria-label="Conversaciones" className="flex min-h-0 flex-col gap-2 rounded-[22px] border border-line bg-white p-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <input
          type="checkbox"
          aria-label="Seleccionar todos los chats"
          checked={allChecked}
          ref={(el) => {
            if (el) el.indeterminate = some && !allChecked;
          }}
          onChange={() => onCheckAll(!allChecked)}
          className="ml-1 size-4 flex-none cursor-pointer accent-ink"
        />
        {some ? (
          <>
            <span className="text-[12px] font-bold text-muted" aria-live="polite">{checked.size} seleccionados</span>
            <Button size="sm" variant="outline" disabled={bulkBusy} onClick={() => onBulk({ type: "close" })}>
              <CircleCheck aria-hidden className="size-4" /> Cerrar
            </Button>
            <Popover label="Asignar seleccionados" disabled={bulkBusy} trigger={<><UserPlus aria-hidden className="size-4" /> Asignar</>}>
              {(close) => (
                <div className="flex flex-col">
                  <MenuItem onClick={() => { onBulk({ type: "assign", assignee: null }); close(); }}>Sin asignar</MenuItem>
                  <MenuItem onClick={() => { onBulk({ type: "assign", assignee: meId }); close(); }}>Yo</MenuItem>
                  {(members ?? []).filter((m) => m.userId !== meId).map((m) => (
                    <MenuItem key={m.userId} onClick={() => { onBulk({ type: "assign", assignee: m.userId }); close(); }}>{m.name ?? m.email}</MenuItem>
                  ))}
                </div>
              )}
            </Popover>
            <Popover label="Etiquetar seleccionados" disabled={bulkBusy} trigger={<><Tag aria-hidden className="size-4" /> Etiquetar</>}>
              {(close) => (
                <div className="flex flex-col">
                  {tags.map((t) => (
                    <MenuItem key={t.id} onClick={() => { onBulk({ type: "tag", tag: t.name }); close(); }}>
                      <span aria-hidden>{t.emoji ?? "🏷"}</span> {t.name}
                    </MenuItem>
                  ))}
                  {tags.length === 0 ? <p className="m-0 p-2 text-xs text-muted">Crea una etiqueta en la barra lateral.</p> : null}
                </div>
              )}
            </Popover>
          </>
        ) : (
          <>
            <select
              aria-label="Estado"
              value={controls.status}
              disabled={folderFixesStatus(folder)}
              onChange={(e) => set({ status: e.target.value as StatusFilter })}
              className={SELECT}
            >
              <option value="open">Abiertos</option>
              <option value="closed">Cerrados</option>
              <option value="all">Todos</option>
            </select>
            <button
              type="button"
              aria-pressed={controls.unread}
              onClick={() => set({ unread: !controls.unread })}
              className={cn("h-9 cursor-pointer rounded-full border-[1.5px] px-3 text-[12px] font-bold", controls.unread ? "border-ink bg-ink text-white" : "border-line-2 bg-white text-ink")}
            >
              No leídos
            </button>
            <select aria-label="Ordenar" value={controls.sort} onChange={(e) => set({ sort: e.target.value as ListControls["sort"] })} className={SELECT}>
              <option value="newest">Más reciente</option>
              <option value="oldest">Más antiguo</option>
            </select>
            {/* Room for more channels: only WhatsApp exists today. */}
            <select aria-label="Canal" value="whatsapp" onChange={() => undefined} className={SELECT}>
              <option value="whatsapp">WhatsApp</option>
            </select>
            <InboxFilter filter={filter} onChange={onFilter} info={filterInfo} />
          </>
        )}
      </div>
      <Alert>{error}</Alert>
      <ul className="m-0 flex min-h-0 flex-1 list-none flex-col gap-0.5 overflow-y-auto p-0" data-testid="conversation-list">
        {items.map((c) => (
          <ConversationItem
            key={c.id}
            conversation={c}
            selected={c.id === selectedId}
            onSelect={() => onSelect(c.id)}
            checked={checked.has(c.id)}
            onCheck={() => onCheck(c.id)}
            tagMeta={tagMeta}
          />
        ))}
        {!loading && items.length === 0 ? <li className="px-3 py-8 text-center text-sm text-muted">No hay conversaciones aquí.</li> : null}
        {loading ? <li className="px-3 py-8 text-center text-sm text-muted" aria-busy="true">Cargando…</li> : null}
        {hasMore ? (
          <li className="flex justify-center py-2">
            <Button size="sm" variant="outline" disabled={loadingMore} onClick={onLoadMore}>{loadingMore ? "Cargando…" : "Cargar más"}</Button>
          </li>
        ) : null}
      </ul>
    </section>
  );
}
