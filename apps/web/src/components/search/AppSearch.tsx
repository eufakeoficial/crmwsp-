"use client";

import { Contact, Inbox, Search, type LucideIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "@/components/app/SessionProvider";
import { NAV_GROUPS, NAV_SECONDARY, SETTINGS_SECTIONS, type NavItem } from "@/components/app/nav-items";
import { useDialogBehavior } from "@/lib/hooks/use-dialog";
import { searchApp, suggestedEntries } from "@/lib/app-search";
import { REMOTE_DEBOUNCE_MS, REMOTE_LIMIT, contactsSearchHref, inboxConversationHref, inboxSearchHref, remoteQuery, snippet } from "@/lib/app-search-helpers";
import { contactsApi } from "@/lib/inbox-api";
import { inboxV2Api } from "@/lib/inbox-v2-api";

const RECENT_KEY = "crmwsp.app-search.recent";

interface Row {
  id: string;
  group: string;
  title: string;
  sub: string;
  href: string;
  icon: LucideIcon;
  /** Pages (not contacts/conversations) are remembered as recents. */
  page: boolean;
}

function iconIndex(): Map<string, LucideIcon> {
  const map = new Map<string, LucideIcon>();
  const walk = (items: readonly NavItem[]) =>
    items.forEach((i) => {
      if (!map.has(i.href)) map.set(i.href, i.icon);
      if (i.children) walk(i.children);
    });
  for (const g of NAV_GROUPS) {
    if (g.href && !map.has(g.href)) map.set(g.href, g.icon);
    walk(g.children ?? []);
  }
  walk(NAV_SECONDARY);
  walk(SETTINGS_SECTIONS);
  return map;
}
const ICONS = iconIndex();

function readRecents(): string[] {
  try {
    const raw: unknown = JSON.parse(window.localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string").slice(0, 5) : [];
  } catch {
    return [];
  }
}

function saveRecent(entryId: string) {
  try {
    const next = [entryId, ...readRecents().filter((h) => h !== entryId)].slice(0, 5);
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable: recents are a convenience only */
  }
}

type RemoteState = { status: "idle" } | { status: "loading" } | { status: "done"; contacts: Row[]; conversations: Row[] };

/** Debounced contact + conversation search. Stale responses are ignored; errors degrade to empty groups. */
function useRemoteResults(query: string): RemoteState {
  const [state, setState] = useState<RemoteState>({ status: "idle" });
  const seq = useRef(0);
  useEffect(() => {
    const q = remoteQuery(query);
    const id = ++seq.current;
    if (q === null) {
      setState({ status: "idle" });
      return;
    }
    setState({ status: "loading" });
    const timer = setTimeout(() => {
      const contacts = contactsApi.list({ q, limit: REMOTE_LIMIT }).then(
        (r): Row[] =>
          r.items.slice(0, REMOTE_LIMIT).map((c) => ({
            id: `contact-${c.id}`,
            group: "Clientes",
            title: c.name?.trim() || c.phoneE164,
            sub: c.name?.trim() ? c.phoneE164 : "",
            href: contactsSearchHref(c.phoneE164),
            icon: Contact,
            page: false,
          })),
        () => [] as Row[],
      );
      const conversations = inboxV2Api.list({ q, limit: REMOTE_LIMIT }).then(
        (r): Row[] =>
          r.items.slice(0, REMOTE_LIMIT).map((c) => ({
            id: `conversation-${c.id}`,
            group: "Conversaciones",
            title: c.contact.name?.trim() || c.contact.phoneE164,
            sub: snippet(c.lastMessage?.preview) || c.contact.phoneE164,
            href: inboxConversationHref(c.id),
            icon: Inbox,
            page: false,
          })),
        () => [] as Row[],
      );
      void Promise.all([contacts, conversations]).then(([cs, vs]) => {
        if (id === seq.current) setState({ status: "done", contacts: cs, conversations: vs });
      });
    }, REMOTE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);
  return state;
}

/** Command palette (Ctrl/Cmd + K): app sections and actions ranked locally, plus contacts and conversations from the API. */
export function AppSearch({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const { tenant } = useSession();
  const role = tenant?.role;
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [recents] = useState(readRecents);
  useDialogBehavior(ref, onClose);
  const remote = useRemoteResults(query);
  const q = remoteQuery(query);

  const rows = useMemo<Row[]>(() => {
    const toRow = (e: { id: string; label: string; description: string; href: string; section: string }): Row => ({
      id: `page-${e.id}`,
      group: e.section,
      title: e.label,
      sub: e.description,
      href: e.href,
      icon: ICONS.get(e.href) ?? Search,
      page: true,
    });
    const local = query.trim() === "" ? suggestedEntries(role, recents).map((e) => ({ ...toRow(e), group: recents.includes(e.id) ? "Recientes" : "Sugeridos" })) : searchApp(query, role).map((r) => toRow(r.entry));
    const out = [...local];
    if (remote.status === "done") out.push(...remote.contacts, ...remote.conversations);
    if (q !== null) {
      out.push({ id: "inbox-search", group: "Inbox", title: `Buscar «${q}» en el inbox`, sub: "Mensajes, nombres y teléfonos", href: inboxSearchHref(q), icon: Search, page: false });
    }
    return out;
  }, [query, role, recents, remote, q]);

  useEffect(() => setActive(0), [query]);
  useEffect(() => setActive((a) => Math.min(a, Math.max(rows.length - 1, 0))), [rows.length]);

  const go = (row: Row) => {
    if (row.page) saveRecent(row.id.replace(/^page-/, ""));
    router.push(row.href);
    onClose();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (rows.length === 0) return;
      setActive((a) => (a + (e.key === "ArrowDown" ? 1 : -1) + rows.length) % rows.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const row = rows[active];
      if (row) go(row);
    }
  };
  useEffect(() => {
    ref.current?.querySelector(`[data-row="${active}"]`)?.scrollIntoView?.({ block: "nearest" });
  }, [active]);

  const groups: { name: string; items: { row: Row; index: number }[] }[] = [];
  rows.forEach((row, index) => {
    const last = groups[groups.length - 1];
    if (last && last.name === row.group) last.items.push({ row, index });
    else groups.push({ name: row.group, items: [{ row, index }] });
  });
  const noResults = q !== null && remote.status === "done" && rows.length === 1;
  const localEmpty = query.trim() !== "" && rows.filter((r) => r.page).length === 0;

  return (
    <>
      <div onClick={onClose} aria-hidden className="fixed inset-0 z-[60] bg-ink/50" />
      <div ref={ref} role="dialog" aria-modal="true" aria-label="Buscar en el panel" tabIndex={-1} className="fixed top-[72px] left-1/2 z-[61] w-[min(640px,calc(100vw-24px))] -translate-x-1/2 overflow-hidden rounded-3xl bg-white shadow-[0_24px_60px_rgba(18,18,18,.3)]">
        <div className="flex h-[60px] items-center gap-2.5 border-b border-line px-[18px]">
          <Search aria-hidden className="size-5 flex-none" />
          <input
            data-autofocus
            role="combobox"
            aria-expanded="true"
            aria-controls="app-search-list"
            aria-activedescendant={rows[active] ? `app-search-opt-${active}` : undefined}
            aria-autocomplete="list"
            autoComplete="off"
            spellCheck={false}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Buscar secciones, clientes o mensajes"
            aria-label="Buscar"
            className="min-w-0 flex-1 bg-transparent text-[17px] text-ink outline-none"
          />
          <span aria-hidden className="text-xs font-bold text-muted">Esc</span>
        </div>
        <div id="app-search-list" role="listbox" aria-label="Resultados" className="max-h-[420px] overflow-y-auto p-2">
          {groups.map((g) => (
            <div key={g.name} role="group" aria-label={g.name}>
              <div aria-hidden className="px-2.5 pt-2 pb-1 text-xs font-bold tracking-wide text-muted uppercase">{g.name}</div>
              {g.items.map(({ row, index }) => {
                const Icon = row.icon;
                return (
                  <div
                    key={row.id}
                    id={`app-search-opt-${index}`}
                    data-row={index}
                    role="option"
                    aria-selected={index === active}
                    onMouseMove={() => active !== index && setActive(index)}
                    onClick={() => go(row)}
                    className={`flex cursor-pointer items-center gap-3 rounded-[14px] p-2.5 text-ink ${index === active ? "bg-paper" : ""}`}
                  >
                    <span className="grid size-9 flex-none place-items-center rounded-[10px] bg-paper"><Icon aria-hidden className="size-[18px]" /></span>
                    <span className="min-w-0 flex-1">
                      <b className="block truncate text-[14px]">{row.title}</b>
                      {row.sub ? <span className="block truncate text-[13px] text-muted">{row.sub}</span> : null}
                    </span>
                  </div>
                );
              })}
            </div>
          ))}
          {remote.status === "loading" ? <div role="status" className="px-3 py-2 text-[13px] text-muted">Buscando clientes y conversaciones…</div> : null}
          {(noResults && localEmpty) || (query.trim() !== "" && q === null && rows.length === 0) ? (
            <div role="status" className="p-5 text-center text-muted">Sin resultados para “{query.trim()}”.</div>
          ) : null}
          {remote.status === "done" && remote.contacts.length + remote.conversations.length === 0 && !localEmpty ? (
            <div role="status" className="px-3 py-2 text-[13px] text-muted">Sin clientes ni conversaciones para “{q}”.</div>
          ) : null}
        </div>
      </div>
    </>
  );
}
