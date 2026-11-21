"use client";

import { type ContactFilter, type ContactSegment, type ContactTagCount, EMPTY_CONTACT_FILTER } from "@crmwsp/contracts";
import { ListFilter } from "lucide-react";
import { useEffect, useState } from "react";
import { FilterBuilder } from "@/components/contacts/FilterBuilder";
import { contactBookApi } from "@/lib/contacts-api";
import { segmentsApi } from "@/lib/segments-api";
import { Popover } from "./Popover";

const PAGE = 100;
const MAX_PAGES = 5;

export interface FilterIds {
  ids: ReadonlySet<string> | null;
  /** More contacts matched than the client resolves (MAX_PAGES * PAGE). */
  truncated: boolean;
  loading: boolean;
}

/**
 * GET /inbox/conversations has no contact-filter parameter, so the T22 filter is resolved
 * against the contact book (POST /contact-book/search) and the chat list is narrowed client-side
 * by contact id. Resolution is capped at MAX_PAGES * PAGE contacts.
 */
export function useContactFilterIds(filter: ContactFilter): FilterIds {
  const [state, setState] = useState<FilterIds>({ ids: null, truncated: false, loading: false });
  const key = JSON.stringify(filter);
  useEffect(() => {
    if (filter.conditions.length === 0) {
      setState({ ids: null, truncated: false, loading: false });
      return;
    }
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
    (async () => {
      const ids = new Set<string>();
      let cursor: string | undefined;
      let truncated = false;
      for (let page = 0; page < MAX_PAGES; page++) {
        const res = await contactBookApi.search({ filter, limit: PAGE, ...(cursor ? { cursor } : {}) });
        for (const c of res.items) ids.add(c.id);
        if (!res.nextCursor) break;
        cursor = res.nextCursor;
        if (page === MAX_PAGES - 1) truncated = true;
      }
      if (!cancelled) setState({ ids, truncated, loading: false });
    })().catch(() => {
      // Unresolvable filter: show no chats rather than silently ignoring it.
      if (!cancelled) setState({ ids: new Set(), truncated: false, loading: false });
    });
    return () => {
      cancelled = true;
    };
  }, [key]);
  return state;
}

/** "+ Filtro": the T22 chip builder inside a popover. */
export function InboxFilter({ filter, onChange, info }: { filter: ContactFilter; onChange: (f: ContactFilter) => void; info: FilterIds }) {
  const active = filter.conditions.length;
  return (
    <Popover
      label="Filtro de contactos"
      align="right"
      panelClassName="w-[min(560px,92vw)]"
      triggerClassName={active ? "h-9 border-[1.5px] border-royal bg-royal font-semibold text-white" : "h-9 border-[1.5px] border-line-2 bg-paper font-medium hover:border-royal hover:bg-royal-soft"}
      trigger={
        <>
          {active ? <ListFilter aria-hidden className="size-4" /> : null}
          {active ? `Filtro (${active})` : "+ Filtro"}
        </>
      }
    >
      {() => <FilterPanel filter={filter} onChange={onChange} info={info} />}
    </Popover>
  );
}

function FilterPanel({ filter, onChange, info }: { filter: ContactFilter; onChange: (f: ContactFilter) => void; info: FilterIds }) {
  const [tags, setTags] = useState<ContactTagCount[]>([]);
  const [segments, setSegments] = useState<ContactSegment[]>([]);
  const [currency, setCurrency] = useState("EUR");
  useEffect(() => {
    let cancelled = false;
    Promise.all([contactBookApi.tags(), segmentsApi.list()]).then(
      ([t, s]) => {
        if (cancelled) return;
        setTags(t.items);
        setCurrency(t.currency);
        setSegments(s.items);
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, []);
  return (
    <div className="flex flex-col gap-2 p-1">
      <FilterBuilder filter={filter} onChange={onChange} tags={tags} segments={segments} currency={currency} />
      <p className="m-0 text-xs text-muted" aria-live="polite">
        {info.loading
          ? "Aplicando filtro…"
          : info.ids
            ? `${info.ids.size}${info.truncated ? "+" : ""} contactos coinciden${info.truncated ? " (límite de resolución alcanzado)" : ""}.`
            : "Filtra los chats por los datos del contacto."}
      </p>
      {filter.conditions.length ? (
        <button type="button" onClick={() => onChange(EMPTY_CONTACT_FILTER)} className="cursor-pointer self-start bg-transparent p-0 text-xs font-bold text-info underline">
          Quitar filtros
        </button>
      ) : null}
    </div>
  );
}
