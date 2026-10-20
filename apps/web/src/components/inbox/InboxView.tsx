"use client";

import {
  type Contact,
  type ContactFilter,
  type ContactPanel as ContactPanelDto,
  type ConversationNote,
  EMPTY_CONTACT_FILTER,
  type InboxConversation,
  type TagDto,
  type TenantMember,
} from "@crmwsp/contracts";
import { MessageSquare, Search, Settings } from "lucide-react";
import { type FormEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "@/components/app/SessionProvider";
import { useInboxEvents } from "@/components/app/TenantEventsProvider";
import { Alert, Toast } from "@/components/ui";
import { api } from "@/lib/api";
import { contactBookApi } from "@/lib/contacts-api";
import { useThread } from "@/lib/hooks/use-thread";
import { useToast } from "@/lib/hooks/use-toast";
import { contactsApi } from "@/lib/inbox-api";
import { inboxV2Api } from "@/lib/inbox-v2-api";
import { errorMessage } from "@/lib/messages";
import { NotificationBell } from "@/components/app/notifications/NotificationBell";
import { ContactPanel } from "./ContactPanel";
import { AUTO_ASSIGN, type ReminderInput } from "./ConversationHeader";
import { type BulkAction, ConversationList, ListToolbar, type ListControls } from "./ConversationList";
import { ConversationThread } from "./ConversationThread";
import { FolderSidebar } from "./FolderSidebar";
import { useContactFilterIds } from "./InboxFilter";
import { InboxSettingsDrawer } from "./InboxSettingsDrawer";
import { type FolderId, folderParams } from "./inbox-meta";
import { useInboxCounts, useInboxList } from "./use-inbox-list";

const REFRESH_DEBOUNCE_MS = 250;
const SEARCH_DEBOUNCE_MS = 400;

const FOLDER_OPTIONS: { id: FolderId; label: string }[] = [
  { id: "all", label: "Todos los chats" },
  { id: "open", label: "Abiertos" },
  { id: "closed", label: "Cerrados" },
  { id: "mine", label: "Asignados a mí" },
  { id: "unassigned", label: "Sin asignar" },
  { id: "reminders", label: "Recordatorios" },
];

/** Picks the agent with the fewest open chats among the loaded list (client-side heuristic). */
export function pickAutoAssignee(members: readonly TenantMember[], items: readonly InboxConversation[]): string | null {
  const agents = members.filter((m) => m.role !== "viewer");
  if (agents.length === 0) return null;
  const load = new Map(agents.map((m) => [m.userId, 0]));
  for (const c of items) {
    if (c.inboxStatus === "open" && c.assignee && load.has(c.assignee.id)) load.set(c.assignee.id, (load.get(c.assignee.id) ?? 0) + 1);
  }
  return [...agents].sort((a, b) => (load.get(a.userId) ?? 0) - (load.get(b.userId) ?? 0))[0]?.userId ?? null;
}

export function InboxView({ composerSlot }: { composerSlot?: (conversation: InboxConversation) => ReactNode } = {}) {
  const { me, tenant } = useSession();
  const tenantId = tenant?.id ?? null;
  const canConfigure = tenant?.role === "owner" || tenant?.role === "admin";

  const [folder, setFolder] = useState<FolderId>("all");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [controls, setControls] = useState<ListControls>({ status: "open", unread: false, sort: "newest" });
  const [searchDraft, setSearchDraft] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ContactFilter>(EMPTY_CONTACT_FILTER);
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);
  const [mobilePanel, setMobilePanel] = useState(false);
  const [hideSystem, setHideSystem] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [members, setMembers] = useState<TenantMember[] | null>(null);
  const [tags, setTags] = useState<TagDto[]>([]);
  const [detail, setDetail] = useState<InboxConversation | null>(null);
  const [notes, setNotes] = useState<ConversationNote[]>([]);
  const [contact, setContact] = useState<Contact | null>(null);
  const [panel, setPanel] = useState<ContactPanelDto | null>(null);
  const [busy, setBusy] = useState(false);
  const { message: toast, show } = useToast(3500);

  const listParams = useMemo(
    () => ({ ...folderParams(folder, controls.status), sort: controls.sort, ...(controls.unread ? { unread: true } : {}), ...(query ? { q: query } : {}) }),
    [folder, controls, query],
  );
  const list = useInboxList(tenantId, listParams);
  const { refresh: refreshList } = list;
  const { counts, refresh: refreshCounts } = useInboxCounts(tenantId);
  const filterInfo = useContactFilterIds(filter);
  const thread = useThread(selectedId, me.user.id, () => {
    void refreshList();
    void refreshCounts();
  });
  const { refresh: refreshThread } = thread;

  const loadDetail = useCallback(async (id: string) => {
    try {
      const d = await inboxV2Api.get(id);
      setDetail((prev) => (prev === null || prev.id === id ? d : prev));
    } catch {
      /* the thread hook reports load errors */
    }
  }, []);
  const loadNotes = useCallback(async (id: string) => {
    try {
      const res = await inboxV2Api.notes(id);
      setNotes((prev) => (res.items.length === 0 && prev.length === 0 ? prev : res.items));
    } catch {
      /* notes are best effort */
    }
  }, []);
  const loadTags = useCallback(async () => {
    try {
      setTags((await inboxV2Api.tags()).items);
    } catch {
      /* the folder list just shows no tags */
    }
  }, []);
  const refreshAll = useCallback(() => {
    void refreshList();
    void refreshCounts();
  }, [refreshList, refreshCounts]);

  // Debounced refresh from SSE: several events in a burst cause one reload. Counts refetch on every event.
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latest = useRef({ selectedId, refreshAll, refreshThread, loadDetail, loadNotes });
  useEffect(() => {
    latest.current = { selectedId, refreshAll, refreshThread, loadDetail, loadNotes };
  });
  useEffect(() => () => clearTimeout(timer.current), []);
  const eventsStatus = useInboxEvents((event) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const cur = latest.current;
      cur.refreshAll();
      const current = event.type === "resync" || event.conversationId === cur.selectedId;
      if (current && cur.selectedId) {
        void cur.refreshThread();
        void cur.loadDetail(cur.selectedId);
        void cur.loadNotes(cur.selectedId);
      }
    }, REFRESH_DEBOUNCE_MS);
  });

  useEffect(() => {
    let cancelled = false;
    api.members().then(
      (res) => !cancelled && setMembers(res.items),
      // The agent role gets 403 (or any failure): only "Yo" / "Sin asignar" are offered.
      () => !cancelled && setMembers(null),
    );
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  useEffect(() => {
    setSelectedId(null);
    setTags([]);
    if (tenantId !== null) void loadTags();
  }, [tenantId, loadTags]);

  // Opening a conversation: detail + notes. The thread hook loads the messages.
  useEffect(() => {
    setDetail(null);
    setNotes([]);
    setMobilePanel(false);
    if (!selectedId) return;
    void loadDetail(selectedId);
    void loadNotes(selectedId);
  }, [selectedId, loadDetail, loadNotes]);

  const contactId = detail?.contact.id;
  const loadPanel = useCallback(async (id: string) => {
    try {
      setPanel(await inboxV2Api.contactPanel(id));
    } catch {
      setPanel(null);
    }
  }, []);
  useEffect(() => {
    setContact(null);
    setPanel(null);
    if (!contactId) return;
    let cancelled = false;
    contactsApi.get(contactId).then((c) => !cancelled && setContact(c), () => undefined);
    inboxV2Api.contactPanel(contactId).then((p) => !cancelled && setPanel(p), () => undefined);
    return () => {
      cancelled = true;
    };
  }, [contactId]);

  // Global search: debounce typing, submit applies at once.
  useEffect(() => {
    const t = setTimeout(() => setQuery(searchDraft.trim().slice(0, 100)), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [searchDraft]);
  const submitSearch = (e: FormEvent) => {
    e.preventDefault();
    setQuery(searchDraft.trim().slice(0, 100));
  };

  // Changing the view invalidates the bulk selection.
  useEffect(() => {
    setChecked(new Set());
  }, [listParams, filter, tenantId]);

  const visible = useMemo(
    () => (filterInfo.ids ? list.items.filter((c) => filterInfo.ids?.has(c.contact.id)) : list.items),
    [list.items, filterInfo.ids],
  );
  const tagMeta = useMemo(() => new Map(tags.map((t) => [t.name, { emoji: t.emoji, color: t.color }])), [tags]);

  /** Runs an action with the busy flag; failures show a toast. */
  const act = useCallback(
    async (fn: () => Promise<void>, failure: string) => {
      setBusy(true);
      try {
        await fn();
      } catch {
        show(failure);
      } finally {
        setBusy(false);
      }
    },
    [show],
  );

  const applyDetail = useCallback(
    (d: InboxConversation) => {
      setDetail(d);
      refreshAll();
    },
    [refreshAll],
  );

  const assign = (value: string | null) => {
    if (!selectedId) return;
    let assignee = value;
    if (value === AUTO_ASSIGN) {
      assignee = members ? pickAutoAssignee(members, list.items) : null;
      if (!assignee) {
        show("No hay agentes disponibles para asignar");
        return;
      }
    }
    void act(async () => applyDetail(await inboxV2Api.assign(selectedId, assignee)), "No se pudo asignar la conversación");
  };

  const toggleStatus = () => {
    if (!selectedId || !detail) return;
    const next = detail.inboxStatus === "closed" ? "open" : "closed";
    void act(async () => applyDetail(await inboxV2Api.setStatus(selectedId, next)), "No se pudo cambiar el estado");
  };

  const markUnread = () => {
    if (!selectedId) return;
    void act(async () => {
      await inboxV2Api.markUnread(selectedId);
      setSelectedId(null);
      refreshAll();
    }, "No se pudo marcar como no leído");
  };

  const remind = (input: ReminderInput) => {
    if (!selectedId) return;
    void act(async () => {
      await inboxV2Api.addReminder(selectedId, input);
      await loadDetail(selectedId);
      refreshAll();
      show("Te lo recordaremos");
    }, "No se pudo crear el recordatorio");
  };

  const pause = (minutes: number | null) => {
    if (!contactId || !selectedId) return;
    void act(async () => {
      await inboxV2Api.pauseAutomations(contactId, minutes);
      await Promise.all([loadDetail(selectedId), loadPanel(contactId)]);
      show(minutes === null ? "Automatizaciones reanudadas" : "Automatizaciones en pausa");
    }, "No se pudo cambiar la pausa de automatizaciones");
  };

  const setContactTag = (name: string, on: boolean) => {
    if (!detail) return;
    const current = detail.contactTags;
    const next = on ? (current.includes(name) ? current : [...current, name]) : current.filter((t) => t !== name);
    void act(async () => {
      await contactBookApi.setTags(detail.contact.id, next);
      await Promise.all([loadDetail(detail.id), loadPanel(detail.contact.id)]);
      refreshAll();
      void loadTags();
    }, "No se pudo actualizar las etiquetas");
  };

  const createTag = async (input: { name: string; emoji: string | null; color: string | null }) => {
    try {
      await inboxV2Api.createTag(input);
      await loadTags();
      return true;
    } catch (err) {
      show(errorMessage(err));
      return false;
    }
  };

  const sendNote = async (text: string) => {
    if (!selectedId) return false;
    try {
      const note = await inboxV2Api.addNote(selectedId, text);
      setNotes((prev) => (prev.some((n) => n.id === note.id) ? prev : [...prev, note]));
      return true;
    } catch {
      show("No se pudo guardar la nota");
      return false;
    }
  };

  const bulk = (action: BulkAction) => {
    const ids = [...checked];
    if (ids.length === 0) return;
    setBulkBusy(true);
    const byId = new Map(list.items.map((c) => [c.id, c]));
    const run = (id: string): Promise<unknown> => {
      if (action.type === "close") return inboxV2Api.setStatus(id, "closed");
      if (action.type === "assign") return inboxV2Api.assign(id, action.assignee === me.user.id ? "me" : action.assignee);
      const c = byId.get(id);
      if (!c) return Promise.resolve();
      const next = c.contactTags.includes(action.tag) ? c.contactTags : [...c.contactTags, action.tag];
      return contactBookApi.setTags(c.contact.id, next);
    };
    void Promise.allSettled(ids.map(run))
      .then((results) => {
        const failed = results.filter((r) => r.status === "rejected").length;
        show(failed ? `${failed} de ${ids.length} cambios fallaron` : `${ids.length} conversaciones actualizadas`);
        setChecked(new Set());
        refreshAll();
        if (selectedId && ids.includes(selectedId)) void loadDetail(selectedId);
        if (action.type === "tag") void loadTags();
      })
      .finally(() => setBulkBusy(false));
  };

  const toggleChecked = (id: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const selectFolder = (f: FolderId) => {
    setFolder(f);
    setSelectedId(null);
  };

  const listError = list.error ? errorMessage(list.error) : undefined;
  const showPanel = panelOpen && selectedId !== null;
  const cols = showPanel
    ? "desk:grid-cols-[380px_minmax(0,1fr)_340px]"
    : "desk:grid-cols-[380px_minmax(0,1fr)]";
  return (
    <div className="flex h-[calc(100dvh-68px)] min-h-[420px] flex-col bg-white desk:h-dvh">
      {eventsStatus === "limited" ? (
        <Alert tone="info">Hay demasiadas pestañas abiertas con tiempo real: cierra alguna y recarga para recibir mensajes al instante.</Alert>
      ) : eventsStatus === "reconnecting" ? (
        <Alert tone="info">Reconectando el tiempo real…</Alert>
      ) : null}

      <div className="flex flex-none items-center gap-3 border-b border-line bg-white px-3 py-2 desk:h-14 desk:px-4">
        <div className="hidden min-w-0 flex-1 desk:block">
          <h1 className="m-0 truncate text-[18px] font-extrabold">Bandeja de entrada</h1>
        </div>
        <h1 className="sr-only desk:hidden">Bandeja de entrada</h1>
        <form onSubmit={submitSearch} role="search" className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-full border border-line-2 bg-paper pl-4 pr-1 focus-within:outline-3 focus-within:outline-focus desk:w-full desk:max-w-[480px] desk:flex-none">
          <Search aria-hidden className="size-4 flex-none text-muted" />
          <input
            type="search"
            aria-label="Buscar en conversaciones"
            placeholder="Buscar en conversaciones"
            value={searchDraft}
            maxLength={100}
            onChange={(e) => setSearchDraft(e.target.value)}
            className="min-w-0 flex-1 bg-transparent text-[14px] text-ink outline-none placeholder:text-muted"
          />
        </form>
        <select
          aria-label="Carpeta"
          value={folder.startsWith("tag:") ? "" : folder}
          onChange={(e) => selectFolder(e.target.value as FolderId)}
          className="h-9 cursor-pointer rounded-full border border-line-2 bg-white px-3 text-[13px] font-bold desk:hidden"
        >
          {folder.startsWith("tag:") ? <option value="">Etiqueta: {folder.slice(4)}</option> : null}
          {FOLDER_OPTIONS.map((f) => (
            <option key={f.id} value={f.id}>{f.label}</option>
          ))}
        </select>
        <div className="flex flex-none items-center justify-end gap-2 desk:flex-1">
          <NotificationBell triggerClassName="hidden size-9 flex-none border border-line bg-white text-ink desk:grid" />
          {canConfigure ? (
            <button type="button" onClick={() => setSettingsOpen(true)} aria-label="Ajustes de la bandeja" title="Ajustes de la bandeja" className="grid size-9 flex-none cursor-pointer place-items-center rounded-full bg-transparent text-ink hover:bg-paper">
              <Settings aria-hidden className="size-[18px]" />
            </button>
          ) : null}
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 desk:grid-cols-[auto_minmax(0,1fr)]">
        <div className="hidden min-h-0 border-r border-line desk:flex [&>nav]:flex-1">
          <FolderSidebar folder={folder} counts={counts} tags={tags} collapsed={sidebarCollapsed} onCollapse={setSidebarCollapsed} onSelect={selectFolder} onCreateTag={createTag} />
        </div>
        <div className="flex min-h-0 min-w-0 flex-col">
          <div className={selectedId ? "hidden desk:block" : "block"}>
            <ListToolbar
              items={visible}
              folder={folder}
              controls={controls}
              onControls={setControls}
              filter={filter}
              onFilter={setFilter}
              filterInfo={filterInfo}
              checked={checked}
              onCheckAll={(all) => setChecked(all ? new Set(visible.map((c) => c.id)) : new Set())}
              members={members}
              meId={me.user.id}
              tags={tags}
              bulkBusy={bulkBusy}
              onBulk={bulk}
            />
          </div>
          <div className={`grid min-h-0 flex-1 grid-cols-1 ${cols}`}>
            <div className={`min-h-0 flex-col desk:border-r desk:border-line [&>section]:flex-1 ${selectedId ? "hidden desk:flex" : "flex"}`}>
              <ConversationList
                items={visible}
                selectedId={selectedId}
                checked={checked}
                onCheck={toggleChecked}
                tagMeta={tagMeta}
                loading={list.loading || filterInfo.loading}
                loadingMore={list.loadingMore}
                hasMore={list.nextCursor !== null}
                error={listError}
                onSelect={setSelectedId}
                onLoadMore={() => void list.loadMore()}
              />
            </div>
            {selectedId ? (
              <>
                <div className={`min-h-0 min-w-0 flex-col [&>section]:flex-1 ${mobilePanel ? "hidden desk:flex" : "flex"}`}>
                  <ConversationThread
                    conversationId={selectedId}
                    conversation={detail}
                    messages={thread.messages}
                    notes={notes}
                    members={members}
                    meId={me.user.id}
                    tags={tags}
                    hasOlder={thread.hasOlder}
                    loadingOlder={thread.loadingOlder}
                    loading={thread.loading}
                    blocked={thread.blocked}
                    busy={busy}
                    panelOpen={panelOpen}
                    hideSystem={hideSystem}
                    error={thread.error ? errorMessage(thread.error) : undefined}
                    composerSlot={detail && composerSlot ? composerSlot(detail) : undefined}
                    actions={{
                      onBack: () => setSelectedId(null),
                      onTogglePanel: () => {
                        setPanelOpen((v) => !v);
                        setMobilePanel((v) => !v);
                      },
                      onAssign: assign,
                      onToggleTag: setContactTag,
                      onCreateTag: createTag,
                      onRemind: remind,
                      onToggleStatus: toggleStatus,
                      onMarkUnread: markUnread,
                      onPause: pause,
                    }}
                    onHideSystem={setHideSystem}
                    onSend={thread.send}
                    onSendNote={sendNote}
                    onSendTemplate={thread.sendTemplate}
                    onLoadOlder={() => void thread.loadOlder()}
                  />
                </div>
                <div className={`min-h-0 flex-col desk:border-l desk:border-line ${mobilePanel ? "flex" : "hidden"} ${panelOpen ? "desk:flex" : "desk:hidden"}`}>
                  {detail ? (
                    <ContactPanel
                      conversation={detail}
                      contact={contact}
                      panel={panel}
                      tags={tags}
                      busy={busy}
                      onToggleTag={setContactTag}
                      onPause={pause}
                      onClose={() => {
                        setMobilePanel(false);
                        setPanelOpen(false);
                      }}
                    />
                  ) : null}
                </div>
              </>
            ) : (
              <div className="hidden min-h-0 flex-col items-center justify-center gap-2 bg-paper-2 text-center text-muted desk:flex">
                <MessageSquare aria-hidden className="size-8" />
                <p className="m-0 font-bold">Elige una conversación</p>
              </div>
            )}
          </div>
        </div>
      </div>
      {settingsOpen ? <InboxSettingsDrawer onClose={() => setSettingsOpen(false)} onSaved={() => { show("Ajustes guardados"); refreshAll(); }} /> : null}
      <Toast message={toast} tone="warn" />
    </div>
  );
}
