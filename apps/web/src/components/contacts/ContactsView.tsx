"use client";

import {
  BULK_MAX_ROWS,
  EMPTY_CONTACT_FILTER,
  type ContactBookItem,
  type ContactBulkRequest,
  type ContactFilter,
  type ContactSegment,
  type ContactTagCount,
} from "@crmwsp/contracts";
import { useCallback, useEffect, useState } from "react";
import { SetupRequiredHint, useSetupMode } from "@/components/app/billing/SetupGate";
import { EmptyState, PageHeader } from "@/components/app/EmptyState";
import { Alert, Avatar, Badge, Button, CheckBox, Input, Modal, SearchInput } from "@/components/ui";
import { contactBookApi } from "@/lib/contacts-api";
import { errorMessage } from "@/lib/messages";
import { segmentsApi } from "@/lib/segments-api";
import { ContactDrawer } from "./ContactDrawer";
import { CONSENT_LABELS, formatWhen } from "./contact-meta";
import { FilterBuilder } from "./FilterBuilder";
import { ImportCsvDialog } from "./ImportCsvDialog";
import { NewContactDialog } from "./NewContactDialog";

const PAGE = 25;
type Selection = { mode: "ids"; ids: Set<string> } | { mode: "all" };
type BulkDialog = { action: "add_tag" | "remove_tag" } | null;

const segmentFilter = (id: string): ContactFilter => ({
  match: "all",
  conditions: [{ field: "segment", type: "relation", operator: "is", value: [id] }],
});
const tagFilter = (tag: string): ContactFilter => ({
  match: "all",
  conditions: [{ field: "tag", type: "relation", operator: "is", value: [tag] }],
});

export function ContactsView() {
  const [draft, setDraft] = useState("");
  const inSetup = useSetupMode();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ContactFilter>(EMPTY_CONTACT_FILTER);
  const [items, setItems] = useState<ContactBookItem[] | null>(null);
  const [total, setTotal] = useState(0);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [tags, setTags] = useState<ContactTagCount[]>([]);
  const [currency, setCurrency] = useState("EUR");
  const [segments, setSegments] = useState<ContactSegment[]>([]);
  const [selection, setSelection] = useState<Selection>({ mode: "ids", ids: new Set() });
  const [menuOpen, setMenuOpen] = useState(false);
  const [bulkDialog, setBulkDialog] = useState<BulkDialog>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);

  const loadSidebar = useCallback(async () => {
    try {
      const [t, s] = await Promise.all([contactBookApi.tags(), segmentsApi.list()]);
      setTags(t.items);
      setCurrency(t.currency);
      setSegments(s.items);
    } catch (err) {
      setError(err);
    }
  }, []);

  const load = useCallback(async () => {
    setItems(null);
    setSelection({ mode: "ids", ids: new Set() });
    try {
      const page = await contactBookApi.search({ filter, q: query, limit: PAGE });
      setItems(page.items);
      setTotal(page.total);
      setCursor(page.nextCursor);
      setError(null);
    } catch (err) {
      setError(err);
      setItems([]);
      setTotal(0);
      setCursor(null);
    }
  }, [filter, query]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    void loadSidebar();
  }, [loadSidebar]);

  async function loadMore() {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const page = await contactBookApi.search({ filter, q: query, limit: PAGE, cursor });
      setItems((list) => [...(list ?? []), ...page.items]);
      setCursor(page.nextCursor);
    } catch (err) {
      setError(err);
    } finally {
      setLoadingMore(false);
    }
  }

  const replace = (next: ContactBookItem) => setItems((list) => list?.map((c) => (c.id === next.id ? next : c)) ?? list);

  const selectedCount = selection.mode === "all" ? total : selection.ids.size;
  const isSelected = (id: string) => selection.mode === "all" || selection.ids.has(id);
  const toggleOne = (id: string) =>
    setSelection((s) => {
      const ids = new Set(s.mode === "all" ? (items ?? []).map((c) => c.id) : s.ids);
      if (ids.has(id)) ids.delete(id);
      else ids.add(id);
      return { mode: "ids", ids };
    });
  const pageIds = (items ?? []).map((c) => c.id);
  const allOnPage = pageIds.length > 0 && pageIds.every(isSelected);
  const togglePage = () => setSelection(allOnPage ? { mode: "ids", ids: new Set() } : { mode: "ids", ids: new Set(pageIds) });

  async function runBulk(action: ContactBulkRequest) {
    setMenuOpen(false);
    setBulkDialog(null);
    try {
      const r = await contactBookApi.bulk(action);
      setNotice(`${r.updated} de ${r.matched} contactos actualizados.`);
      await Promise.all([load(), loadSidebar()]);
    } catch (err) {
      setError(err);
    }
  }
  const bulkSelection = (): ContactBulkRequest["selection"] =>
    selection.mode === "all" ? { filter, ...(query ? { q: query } : {}) } : { ids: [...selection.ids] };

  async function saveSegment(name: string) {
    try {
      await segmentsApi.create({ name, filter });
      setSaveOpen(false);
      setNotice(`Segmento «${name}» guardado.`);
      await loadSidebar();
    } catch (err) {
      setError(err);
    }
  }

  async function deleteSegment(s: ContactSegment) {
    if (!window.confirm(`¿Eliminar el segmento «${s.name}»?`)) return;
    try {
      await segmentsApi.remove(s.id);
      await loadSidebar();
    } catch (err) {
      setError(err);
    }
  }

  return (
    <>
      <PageHeader title="Contactos" subtitle="Tu lista de clientes y personas que te escribieron: busca, filtra y agrupa para dar seguimiento." />
      <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
        <aside className="flex flex-col gap-4 text-sm">
          <section>
            <h2 className="m-0 mb-2 text-[12px] font-bold uppercase text-muted">Segmentos</h2>
            {segments.length === 0 ? <p className="m-0 text-muted">Aún no hay segmentos.</p> : null}
            <ul className="m-0 list-none p-0">
              {segments.map((s) => (
                <li key={s.id} className="group flex items-center gap-1">
                  <button type="button" className="flex flex-1 cursor-pointer justify-between rounded-[10px] bg-transparent px-2 py-1 text-left hover:bg-line" onClick={() => setFilter(segmentFilter(s.id))}>
                    <span className="truncate">{s.name}</span>
                    <span className="text-muted">{s.count}</span>
                  </button>
                  <button type="button" aria-label={`Eliminar ${s.name}`} className="cursor-pointer bg-transparent px-1 text-muted opacity-0 group-hover:opacity-100" onClick={() => void deleteSegment(s)}>
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          </section>
          <section>
            <h2 className="m-0 mb-2 text-[12px] font-bold uppercase text-muted">Etiquetas</h2>
            {tags.length === 0 ? <p className="m-0 text-muted">Sin etiquetas.</p> : null}
            <ul className="m-0 max-h-80 list-none overflow-auto p-0">
              {tags.map((t) => (
                <li key={t.tag}>
                  <button type="button" className="flex w-full cursor-pointer justify-between rounded-[10px] bg-transparent px-2 py-1 text-left hover:bg-line" onClick={() => setFilter(tagFilter(t.tag))}>
                    <span className="truncate">{t.tag}</span>
                    <span className="text-muted">{t.count}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </aside>

        <div className="min-w-0">
          <div className="mb-3 flex flex-wrap items-end gap-2">
            <form
              className="min-w-[220px] flex-1"
              onSubmit={(e) => {
                e.preventDefault();
                setQuery(draft.trim());
              }}
            >
              <SearchInput label="Buscar contactos" placeholder="Nombre o teléfono" value={draft} onChange={(e) => setDraft(e.target.value)} />
            </form>
            <Button variant="outline" disabled={inSetup} title={inSetup ? "Conecta tu WhatsApp para empezar tu prueba" : undefined} onClick={() => setImportOpen(true)}>Importar CSV</Button>
            <Button onClick={() => setNewOpen(true)}>Nuevo contacto</Button>
          </div>

          {inSetup ? <SetupRequiredHint className="mb-3" /> : null}
          <FilterBuilder filter={filter} onChange={setFilter} tags={tags} segments={segments} currency={currency} onSaveSegment={() => setSaveOpen(true)} />

          {error ? <div className="mb-3"><Alert>{errorMessage(error)}</Alert></div> : null}
          {notice ? (
            <p className="mb-3 text-sm font-bold" role="status">
              {notice}
            </p>
          ) : null}

          <div className="relative mb-2 flex flex-wrap items-center gap-3 text-sm">
            <CheckBox checked={allOnPage ? true : selectedCount ? "mixed" : false} onChange={togglePage} label="Seleccionar página" />
            <span>
              {selectedCount ? `${selectedCount} seleccionados de ${total}` : `${total} contactos`}
            </span>
            {selection.mode === "ids" && allOnPage && total > pageIds.length ? (
              <Button variant="ghost" size="sm" disabled={total > BULK_MAX_ROWS} onClick={() => setSelection({ mode: "all" })}>
                Seleccionar los {total} que coinciden
              </Button>
            ) : null}
            {selectedCount ? (
              <div className="relative ml-auto">
                <Button size="sm" aria-expanded={menuOpen} onClick={() => setMenuOpen((o) => !o)}>
                  Acciones masivas
                </Button>
                {menuOpen ? (
                  <ul role="menu" className="absolute right-0 z-40 mt-1 w-56 list-none rounded-[14px] border border-line bg-white p-1 shadow-lg">
                    {(
                      [
                        ["Añadir etiqueta", () => setBulkDialog({ action: "add_tag" })],
                        ["Quitar etiqueta", () => setBulkDialog({ action: "remove_tag" })],
                        ["Marcar acepta marketing", () => void runBulk({ action: "set_marketing_consent", granted: true, selection: bulkSelection() })],
                        ["Marcar no quiere marketing", () => void runBulk({ action: "set_marketing_consent", granted: false, selection: bulkSelection() })],
                      ] as const
                    ).map(([label, run]) => (
                      <li key={label}>
                        <button type="button" role="menuitem" className="w-full cursor-pointer rounded-[10px] bg-transparent px-3 py-2 text-left hover:bg-line" onClick={run}>
                          {label}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
          </div>

          {items === null ? (
            <p className="text-muted" aria-busy="true">Cargando contactos…</p>
          ) : items.length === 0 && !error ? (
            <EmptyState title={query || filter.conditions.length ? "Sin resultados" : "Aún no hay contactos"} {...(query || filter.conditions.length ? {} : { action: { href: "/app/channels", label: "Conectar tu WhatsApp" } })}>
              {query || filter.conditions.length ? "Prueba con otros filtros." : "Primero conecta tu WhatsApp: los contactos aparecerán cuando alguien te escriba."}
            </EmptyState>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {items.map((c) => (
                <li key={c.id} className="flex items-center gap-3">
                  <CheckBox checked={isSelected(c.id)} onChange={() => toggleOne(c.id)} label={`Seleccionar ${c.name ?? c.phoneE164}`} />
                  <button
                    type="button"
                    onClick={() => setOpenId(c.id)}
                    className="grid w-full min-w-0 cursor-pointer items-center gap-x-4 gap-y-1 rounded-[18px] border border-line bg-white px-4 py-3 text-left text-ink hover:border-ink sm:grid-cols-[1.4fr_1.2fr_1fr_auto]"
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      <Avatar name={c.name ?? c.phoneE164} round />
                      <span className="min-w-0">
                        <b className="block truncate">{c.name?.trim() || "Sin nombre"}</b>
                        <span className="text-sm text-muted">{c.phoneE164}</span>
                      </span>
                    </span>
                    <span className="flex flex-wrap gap-1">
                      {c.tags.length ? c.tags.map((t) => <Badge key={t}>{t}</Badge>) : <span className="text-sm text-muted">Sin etiquetas</span>}
                    </span>
                    <span className="text-sm text-muted">Último mensaje: {formatWhen(c.lastMessageAt)}</span>
                    <span className="text-sm font-bold">{CONSENT_LABELS[c.marketingConsent]}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {cursor ? (
            <div className="mt-4 flex justify-center">
              <Button variant="outline" disabled={loadingMore} onClick={() => void loadMore()}>
                {loadingMore ? "Cargando…" : "Cargar más"}
              </Button>
            </div>
          ) : null}
        </div>
      </div>

      {openId ? <ContactDrawer contactId={openId} onClose={() => setOpenId(null)} onChanged={replace} /> : null}
      {bulkDialog ? (
        <TextPrompt
          title={bulkDialog.action === "add_tag" ? "Añadir etiqueta" : "Quitar etiqueta"}
          label="Etiqueta"
          submitLabel={`Aplicar a ${selectedCount}`}
          suggestions={tags.map((t) => t.tag)}
          onClose={() => setBulkDialog(null)}
          onSubmit={(tag) => void runBulk({ action: bulkDialog.action, tag, selection: bulkSelection() })}
        />
      ) : null}
      {saveOpen ? (
        <TextPrompt title="Guardar segmento" label="Nombre del segmento" submitLabel="Guardar" onClose={() => setSaveOpen(false)} onSubmit={(name) => void saveSegment(name)} />
      ) : null}
      {newOpen ? (
        <NewContactDialog
          onClose={() => setNewOpen(false)}
          onCreated={(id) => {
            setNewOpen(false);
            setNotice("Contacto creado.");
            void load();
            void loadSidebar();
            setOpenId(id);
          }}
          onOpenExisting={(id) => {
            setNewOpen(false);
            setOpenId(id);
          }}
        />
      ) : null}
      {importOpen ? (
        <ImportCsvDialog
          onClose={() => setImportOpen(false)}
          onImported={() => {
            void load();
            void loadSidebar();
          }}
        />
      ) : null}
    </>
  );
}

function TextPrompt({
  title,
  label,
  submitLabel,
  suggestions = [],
  onClose,
  onSubmit,
}: {
  title: string;
  label: string;
  submitLabel: string;
  suggestions?: readonly string[];
  onClose: () => void;
  onSubmit: (value: string) => void;
}) {
  const [value, setValue] = useState("");
  const clean = value.trim().slice(0, 80);
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button disabled={!clean} onClick={() => onSubmit(clean)}>{submitLabel}</Button>
        </>
      }
    >
      <Input aria-label={label} placeholder={label} list="text-prompt-suggestions" maxLength={80} value={value} onChange={(e) => setValue(e.target.value)} />
      <datalist id="text-prompt-suggestions">
        {suggestions.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
    </Modal>
  );
}
