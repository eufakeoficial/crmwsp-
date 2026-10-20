"use client";

import type { Contact, ConversationStatus, TenantMember } from "@crmwsp/contracts";
import { MessageSquare } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useInboxEvents } from "@/components/app/TenantEventsProvider";
import { useSession } from "@/components/app/SessionProvider";
import { Alert, SidePanel, Toast } from "@/components/ui";
import { api } from "@/lib/api";
import { useConversationList } from "@/lib/hooks/use-conversation-list";
import { useThread } from "@/lib/hooks/use-thread";
import { useToast } from "@/lib/hooks/use-toast";
import { type AssigneeFilter, contactsApi } from "@/lib/inbox-api";
import { errorMessage } from "@/lib/messages";
import { ContactPanel, contactFields } from "./ContactPanel";
import { ConversationList } from "./ConversationList";
import { ConversationThread } from "./ConversationThread";

const REFRESH_DEBOUNCE_MS = 250;

export function InboxView() {
  const { me, tenant } = useSession();
  const tenantId = tenant?.id ?? null;
  const [status, setStatus] = useState<ConversationStatus>("open");
  const [scope, setScope] = useState<AssigneeFilter | "all">("all");
  const [query, setQuery] = useState("");
  const [matchIds, setMatchIds] = useState<ReadonlySet<string> | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [members, setMembers] = useState<TenantMember[] | null>(null);
  const [contact, setContact] = useState<Contact | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const { message: toast, show } = useToast(3500);

  const list = useConversationList(tenantId, { status, assignedTo: scope === "all" ? undefined : scope });
  const { refresh: refreshList } = list;
  const thread = useThread(selectedId, me.user.id, refreshList);
  const { refresh: refreshThread, conversation } = thread;

  // Debounced refresh from SSE: several events in a burst cause one reload.
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // The timer must call the latest callbacks: filters may change while it is pending.
  const latest = useRef({ selectedId, refreshList, refreshThread });
  useEffect(() => {
    latest.current = { selectedId, refreshList, refreshThread };
  });
  useEffect(() => () => clearTimeout(timer.current), []);
  const eventsStatus = useInboxEvents((event) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const cur = latest.current;
      void cur.refreshList();
      if (event.type === "resync" || event.conversationId === cur.selectedId) void cur.refreshThread();
    }, REFRESH_DEBOUNCE_MS);
  });

  useEffect(() => {
    let cancelled = false;
    api.members().then(
      (res) => !cancelled && setMembers(res.items),
      // The agent role gets 403 (or any failure): fall back to "Asignarme a mí".
      () => !cancelled && setMembers(null),
    );
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  useEffect(() => {
    setSelectedId(null);
  }, [tenantId]);

  // Contact search through GET /contacts?q=; conversations are filtered by contact id.
  useEffect(() => {
    if (!query) {
      setMatchIds(null);
      return;
    }
    let cancelled = false;
    contactsApi.list({ q: query, limit: 100 }).then(
      (res) => !cancelled && setMatchIds(new Set(res.items.map((c) => c.id))),
      () => !cancelled && setMatchIds(new Set()),
    );
    return () => {
      cancelled = true;
    };
  }, [query]);

  const contactId = conversation?.contact.id;
  useEffect(() => {
    setContact(null);
    if (!contactId) return;
    let cancelled = false;
    contactsApi.get(contactId).then((c) => !cancelled && setContact(c), () => undefined);
    return () => {
      cancelled = true;
    };
  }, [contactId]);

  const visible = useMemo(
    () => (matchIds ? list.items.filter((c) => matchIds.has(c.contact.id)) : list.items),
    [list.items, matchIds],
  );

  const mutate = useCallback(
    async (patch: Parameters<typeof thread.update>[0]) => {
      setBusy(true);
      const result = await thread.update(patch);
      setBusy(false);
      if (result === "conflict") show("Otra persona cambió esta conversación");
      else if (result === "error") show("No se pudo guardar el cambio");
    },
    [thread.update, show],
  );

  const listError = list.error ? errorMessage(list.error) : undefined;
  return (
    <div className="-mb-16 flex h-[calc(100dvh-120px)] min-h-[420px] flex-col gap-2">
      <h1 className="sr-only">Inbox</h1>
      {eventsStatus === "limited" ? (
        <Alert tone="info">Hay demasiadas pestañas abiertas con tiempo real: cierra alguna y recarga para recibir mensajes al instante.</Alert>
      ) : eventsStatus === "reconnecting" ? (
        <Alert tone="info">Reconectando el tiempo real…</Alert>
      ) : null}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 desk:grid-cols-[320px_minmax(0,1fr)_280px]">
        <div className={`min-h-0 flex-col [&>section]:flex-1 ${selectedId ? "hidden desk:flex" : "flex"}`}>
          <ConversationList
            items={visible}
            selectedId={selectedId}
            status={status}
            scope={scope}
            query={query}
            loading={list.loading}
            loadingMore={list.loadingMore}
            hasMore={list.nextCursor !== null}
            error={listError}
            onStatus={setStatus}
            onScope={setScope}
            onQuery={setQuery}
            onSelect={setSelectedId}
            onLoadMore={() => void list.loadMore()}
          />
        </div>
        {selectedId ? (
          <>
            <div className="flex min-h-0 min-w-0 flex-col [&>section]:flex-1">
              <ConversationThread
                conversationId={selectedId}
                conversation={thread.conversation}
                messages={thread.messages}
                members={members}
                meId={me.user.id}
                hasOlder={thread.hasOlder}
                loadingOlder={thread.loadingOlder}
                loading={thread.loading}
                blocked={thread.blocked}
                busy={busy}
                error={thread.error ? errorMessage(thread.error) : undefined}
                onBack={() => setSelectedId(null)}
                onInfo={() => setInfoOpen(true)}
                onAssign={(userId) => void mutate({ assignedUserId: userId })}
                onStatus={(s) => void mutate({ status: s })}
                onSend={thread.send}
                onSendTemplate={thread.sendTemplate}
                onLoadOlder={() => void thread.loadOlder()}
              />
            </div>
            {conversation ? <ContactPanel summary={conversation.contact} contact={contact} /> : <div className="hidden desk:block" />}
          </>
        ) : (
          <div className="col-span-2 hidden min-h-0 flex-col items-center justify-center gap-2 rounded-[22px] border border-dashed border-line-2 text-center text-muted desk:flex">
            <MessageSquare aria-hidden className="size-8" />
            <p className="m-0 font-bold">Elige una conversación</p>
          </div>
        )}
      </div>
      {infoOpen && conversation ? (
        <SidePanel title="Ficha del contacto" fields={contactFields(conversation.contact, contact)} onClose={() => setInfoOpen(false)} />
      ) : null}
      <Toast message={toast} tone="warn" />
    </div>
  );
}
