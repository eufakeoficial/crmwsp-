"use client";

import type { ContactBookItem } from "@crmwsp/contracts";
import { useCallback, useEffect, useState } from "react";
import { EmptyState, PageHeader } from "@/components/app/EmptyState";
import { Alert, Avatar, Badge, Button, SearchInput } from "@/components/ui";
import { contactBookApi } from "@/lib/contacts-api";
import { errorMessage } from "@/lib/messages";
import { ContactDrawer } from "./ContactDrawer";
import { CONSENT_LABELS, formatWhen } from "./contact-meta";

export function ContactsView() {
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<ContactBookItem[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setItems(null);
    try {
      const page = await contactBookApi.list({ q: query, limit: 25 });
      setItems(page.items);
      setCursor(page.nextCursor);
      setError(null);
    } catch (err) {
      setError(err);
      setItems([]);
      setCursor(null);
    }
  }, [query]);
  useEffect(() => {
    void load();
  }, [load]);

  async function loadMore() {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const page = await contactBookApi.list({ q: query, limit: 25, cursor });
      setItems((list) => [...(list ?? []), ...page.items]);
      setCursor(page.nextCursor);
    } catch (err) {
      setError(err);
    } finally {
      setLoadingMore(false);
    }
  }

  const replace = (next: ContactBookItem) =>
    setItems((list) => list?.map((c) => (c.id === next.id ? next : c)) ?? list);

  return (
    <>
      <PageHeader title="Contactos" subtitle="Tus clientes, sus etiquetas y su consentimiento de marketing." />
      <form
        className="mb-4 max-w-md"
        onSubmit={(e) => {
          e.preventDefault();
          setQuery(draft.trim());
        }}
      >
        <SearchInput label="Buscar contactos" placeholder="Nombre o teléfono" value={draft} onChange={(e) => setDraft(e.target.value)} />
      </form>

      {error ? <div className="mb-4"><Alert>{errorMessage(error)}</Alert></div> : null}

      {items === null ? (
        <p className="text-muted" aria-busy="true">Cargando contactos…</p>
      ) : items.length === 0 && !error ? (
        <EmptyState title={query ? "Sin resultados" : "Aún no hay contactos"}>
          {query ? "Prueba con otro nombre o teléfono." : "Los contactos aparecerán cuando alguien escriba a tu WhatsApp."}
        </EmptyState>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {items.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => setOpenId(c.id)}
                className="grid w-full cursor-pointer items-center gap-x-4 gap-y-1 rounded-[18px] border border-line bg-white px-4 py-3 text-left text-ink hover:border-ink sm:grid-cols-[1.4fr_1.2fr_1fr_auto]"
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

      {openId ? <ContactDrawer contactId={openId} onClose={() => setOpenId(null)} onChanged={replace} /> : null}
    </>
  );
}
