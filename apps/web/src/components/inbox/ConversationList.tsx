"use client";

import type { Conversation, ConversationStatus } from "@crmwsp/contracts";
import { type FormEvent, useState } from "react";
import { Alert, Button, Chip, SearchInput } from "@/components/ui";
import type { AssigneeFilter } from "@/lib/inbox-api";
import { ConversationItem } from "./ConversationItem";

const TABS: { value: ConversationStatus; label: string }[] = [
  { value: "open", label: "Abiertas" },
  { value: "pending", label: "Pendientes" },
  { value: "resolved", label: "Resueltas" },
];
const SCOPES: { value: AssigneeFilter | "all"; label: string }[] = [
  { value: "me", label: "Mías" },
  { value: "unassigned", label: "Sin asignar" },
  { value: "all", label: "Todas" },
];

export function ConversationList({
  items,
  selectedId,
  status,
  scope,
  query,
  loading,
  loadingMore,
  hasMore,
  error,
  onStatus,
  onScope,
  onQuery,
  onSelect,
  onLoadMore,
}: {
  items: readonly Conversation[];
  selectedId: string | null;
  status: ConversationStatus;
  scope: AssigneeFilter | "all";
  query: string;
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  error: string | undefined;
  onStatus: (s: ConversationStatus) => void;
  onScope: (s: AssigneeFilter | "all") => void;
  onQuery: (q: string) => void;
  onSelect: (id: string) => void;
  onLoadMore: () => void;
}) {
  const [draft, setDraft] = useState(query);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onQuery(draft.trim());
  };
  return (
    <section aria-label="Conversaciones" className="flex min-h-0 flex-col gap-2.5 rounded-[22px] border border-line bg-white p-3">
      <form onSubmit={submit} role="search" className="rounded-full bg-paper">
        <SearchInput
          label="Buscar contactos"
          placeholder="Buscar contacto…"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            if (e.target.value === "") onQuery("");
          }}
          className="bg-transparent"
        />
      </form>
      <div role="tablist" aria-label="Estado" className="no-scrollbar flex gap-1.5 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.value}
            role="tab"
            type="button"
            aria-selected={status === t.value}
            onClick={() => onStatus(t.value)}
            className={`inline-flex h-9 flex-none cursor-pointer items-center rounded-full px-3.5 text-[13px] font-bold ${status === t.value ? "bg-ink text-white" : "bg-paper text-ink hover:bg-line"}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="group" aria-label="Asignación" className="no-scrollbar flex gap-1.5 overflow-x-auto">
        {SCOPES.map((s) => (
          <Chip key={s.label} active={scope === s.value} onClick={() => onScope(s.value)}>{s.label}</Chip>
        ))}
      </div>
      <Alert>{error}</Alert>
      <ul className="m-0 flex min-h-0 flex-1 list-none flex-col gap-0.5 overflow-y-auto p-0" data-testid="conversation-list">
        {items.map((c) => (
          <ConversationItem key={c.id} conversation={c} selected={c.id === selectedId} onSelect={() => onSelect(c.id)} />
        ))}
        {!loading && items.length === 0 ? (
          <li className="px-3 py-8 text-center text-sm text-muted">{query ? "Ningún contacto coincide con la búsqueda." : "No hay conversaciones aquí."}</li>
        ) : null}
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
