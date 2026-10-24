"use client";

import type { ContactBookItem } from "@crmwsp/contracts";
import { useState } from "react";
import { Alert, Button, SearchInput } from "@/components/ui";
import { contactBookApi } from "@/lib/contacts-api";
import { errorMessage } from "@/lib/messages";

/** Search-and-pick of one contact (name or phone). Shows the choice with a "Cambiar" button. */
export function ContactPicker({ value, onChange }: { value: ContactBookItem | null; onChange: (c: ContactBookItem | null) => void }) {
  const [draft, setDraft] = useState("");
  const [results, setResults] = useState<ContactBookItem[] | null>(null);
  const [error, setError] = useState<unknown>(null);

  async function search() {
    setError(null);
    try {
      setResults((await contactBookApi.list({ q: draft.trim(), limit: 6 })).items);
    } catch (err) {
      setError(err);
    }
  }

  if (value) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-[14px] border border-line px-3 py-2 text-sm">
        <span className="min-w-0 truncate">
          <b>{value.name?.trim() || "Sin nombre"}</b> <span className="text-muted">{value.phoneE164}</span>
        </span>
        <Button variant="ghost" size="sm" onClick={() => onChange(null)}>Cambiar</Button>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void search();
        }}
      >
        <SearchInput label="Buscar contacto" placeholder="Nombre o teléfono" className="border-[1.5px] border-ink" value={draft} onChange={(e) => setDraft(e.target.value)} />
      </form>
      {error ? <Alert>{errorMessage(error)}</Alert> : null}
      {results && results.length === 0 ? <p className="m-0 text-sm text-muted">Sin resultados. Crea el contacto desde Contactos con «Nuevo contacto».</p> : null}
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {(results ?? []).map((c) => (
          <li key={c.id}>
            <button type="button" onClick={() => onChange(c)} className="w-full cursor-pointer rounded-[12px] border border-line bg-white px-3 py-2 text-left text-sm hover:border-ink">
              <b>{c.name?.trim() || "Sin nombre"}</b> <span className="text-muted">{c.phoneE164}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
