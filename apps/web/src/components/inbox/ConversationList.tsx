"use client";

import type { ContactFilter, InboxConversation, TagDto, TenantMember } from "@crmwsp/contracts";
import { CircleCheck, Tag, UserPlus } from "lucide-react";
import { useState } from "react";
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

const PILL =
  "h-9 cursor-pointer rounded-full border-[1.5px] border-line-2 bg-paper px-4 text-sm font-medium text-ink hover:border-royal hover:bg-royal-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-royal disabled:cursor-not-allowed disabled:opacity-50";

export type BulkAction = { type: "close" } | { type: "assign"; assignee: string | null } | { type: "tag"; tag: string };

/** One filter row above the list and the conversation: select-all, status, unread, sort, channel and contact filter. */
export function ListToolbar({
  items,
  folder,
  controls,
  onControls,
  filter,
  onFilter,
  filterInfo,
  checked,
  onCheckAll,
  members,
  meId,
  tags,
  bulkBusy,
  onBulk,
}: {
  items: readonly InboxConversation[];
  folder: FolderId;
  controls: ListControls;
  onControls: (next: ListControls) => void;
  filter: ContactFilter;
  onFilter: (f: ContactFilter) => void;
  filterInfo: FilterIds;
  checked: ReadonlySet<string>;
  onCheckAll: (all: boolean) => void;
  members: readonly TenantMember[] | null;
  meId: string;
  tags: readonly TagDto[];
  bulkBusy: boolean;
  onBulk: (action: BulkAction) => void;
}) {
  const [channel, setChannel] = useState("all");
  const allChecked = items.length > 0 && items.every((c) => checked.has(c.id));
  const some = checked.size > 0;
  const set = (patch: Partial<ListControls>) => onControls({ ...controls, ...patch });
  return (
    <div role="toolbar" aria-label="Filtros de conversaciones" className="flex min-h-12 flex-wrap items-center gap-2 border-b border-line bg-white px-3 py-2">
      <input
        type="checkbox"
        aria-label="Seleccionar todos los chats"
        checked={allChecked}
        ref={(el) => {
          if (el) el.indeterminate = some && !allChecked;
        }}
        onChange={() => onCheckAll(!allChecked)}
        className="mx-1 size-4 flex-none cursor-pointer accent-ink"
      />
      {some ? (
        <>
          <span className="text-[13px] font-bold text-muted" aria-live="polite">{checked.size} seleccionados</span>
          <Button size="sm" variant="outline" disabled={bulkBusy} onClick={() => onBulk({ type: "close" })}>
            <CircleCheck aria-hidden className="size-4" /> Cerrar
          </Button>
          <Popover label="Asignar seleccionados" disabled={bulkBusy} triggerClassName={cn(PILL, "inline-flex items-center gap-1")} trigger={<><UserPlus aria-hidden className="size-4" /> Asignar</>}>
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
          <Popover label="Etiquetar seleccionados" disabled={bulkBusy} triggerClassName={cn(PILL, "inline-flex items-center gap-1")} trigger={<><Tag aria-hidden className="size-4" /> Etiquetar</>}>
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
            className={PILL}
          >
            <option value="open">Abiertos</option>
            <option value="closed">Cerrados</option>
            <option value="all">Todos</option>
          </select>
          <button
            type="button"
            aria-pressed={controls.unread}
            onClick={() => set({ unread: !controls.unread })}
            className={cn(PILL, controls.unread && "border-royal bg-royal font-semibold text-white hover:bg-royal hover:border-royal")}
          >
            No leídos
          </button>
          <select aria-label="Ordenar" value={controls.sort} onChange={(e) => set({ sort: e.target.value as ListControls["sort"] })} className={PILL}>
            <option value="newest">Ordenar: Más reciente</option>
            <option value="oldest">Ordenar: Más antiguo</option>
          </select>
          {/* Room for more channels: only WhatsApp exists today, so both options show the same chats. */}
          <select aria-label="Canal" value={channel} onChange={(e) => setChannel(e.target.value)} className={PILL}>
            <option value="all">Todos los canales</option>
            <option value="whatsapp">WhatsApp</option>
          </select>
          <InboxFilter filter={filter} onChange={onFilter} info={filterInfo} />
        </>
      )}
    </div>
  );
}

export function ConversationList({
  items,
  selectedId,
  checked,
  onCheck,
  tagMeta,
  loading,
  loadingMore,
  hasMore,
  error,
  onSelect,
  onLoadMore,
}: {
  items: readonly InboxConversation[];
  selectedId: string | null;
  checked: ReadonlySet<string>;
  onCheck: (id: string) => void;
  tagMeta: ReadonlyMap<string, TagMeta>;
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  error: string | undefined;
  onSelect: (id: string) => void;
  onLoadMore: () => void;
}) {
  return (
    <section aria-label="Conversaciones" className="flex min-h-0 flex-col bg-white">
      <Alert>{error}</Alert>
      <ul className="m-0 flex min-h-0 flex-1 list-none flex-col overflow-y-auto p-0" data-testid="conversation-list">
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
