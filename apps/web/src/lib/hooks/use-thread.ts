"use client";

import type { Conversation, Message, UpdateConversationRequest } from "@crmwsp/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "../api";
import { conversationsApi, newClientMessageId } from "../inbox-api";
import { failMessage, mergeMessages, optimisticMessage, removeMessage } from "../inbox-state";

export type UpdateResult = "ok" | "conflict" | "error";

/** One conversation: detail, timeline (oldest first), optimistic send and PATCH with lockVersion. */
export function useThread(conversationId: string | null, userId: string, onChanged: () => void) {
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [olderCursor, setOlderCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState<unknown>(null);
  /** lastInboundAt for which the server answered 422 OUTSIDE_SERVICE_WINDOW. */
  const [blockedAt, setBlockedAt] = useState<{ id: string; inbound: string | null } | null>(null);
  const idRef = useRef(conversationId);
  const convRef = useRef<Conversation | null>(null);
  const changedRef = useRef(onChanged);
  // Ref guard: two scroll events in the same tick must not fetch the same page twice.
  const olderInFlight = useRef(false);
  useEffect(() => {
    idRef.current = conversationId;
    changedRef.current = onChanged;
  });

  const refresh = useCallback(async (initial = false) => {
    const id = idRef.current;
    if (!id) return;
    try {
      const [conv, page] = await Promise.all([conversationsApi.get(id), conversationsApi.messages(id, { limit: 50 })]);
      if (idRef.current !== id) return;
      convRef.current = conv;
      setConversation(conv);
      // The id-change effect already cleared the timeline; merging keeps optimistic sends made meanwhile.
      setMessages((prev) => mergeMessages(prev, page.items));
      if (initial) setOlderCursor(page.nextCursor);
      setError(null);
      // Viewing a conversation with unread messages marks it as read (also for messages arriving live).
      if (conv.unreadCount > 0) {
        void conversationsApi.markRead(id).then(() => changedRef.current(), () => undefined);
      }
    } catch (err) {
      if (idRef.current === id) setError(err);
    } finally {
      if (idRef.current === id) setLoading(false);
    }
  }, []);

  useEffect(() => {
    convRef.current = null;
    setConversation(null);
    setMessages([]);
    setOlderCursor(null);
    setError(null);
    setLoadingOlder(false);
    olderInFlight.current = false;
    if (conversationId === null) return;
    setLoading(true);
    void refresh(true);
  }, [conversationId, refresh]);

  const loadOlder = useCallback(async () => {
    const id = idRef.current;
    if (!id || !olderCursor || olderInFlight.current) return;
    olderInFlight.current = true;
    setLoadingOlder(true);
    try {
      const page = await conversationsApi.messages(id, { before: olderCursor, limit: 50 });
      if (idRef.current !== id) return;
      setMessages((prev) => mergeMessages(prev, page.items));
      setOlderCursor(page.nextCursor);
    } catch (err) {
      if (idRef.current === id) setError(err);
    } finally {
      olderInFlight.current = false;
      setLoadingOlder(false);
    }
  }, [olderCursor]);

  const send = useCallback(
    async (text: string) => {
      const id = idRef.current;
      if (!id) return;
      const cid = newClientMessageId();
      setMessages((prev) => mergeMessages(prev, [optimisticMessage(id, text, cid, userId)]));
      try {
        const saved = await conversationsApi.send(id, text, cid);
        setMessages((prev) => mergeMessages(prev, [saved]));
        changedRef.current();
      } catch (err) {
        if (err instanceof ApiError && err.code === "OUTSIDE_SERVICE_WINDOW") {
          setMessages((prev) => removeMessage(prev, cid));
          setBlockedAt({ id, inbound: convRef.current?.lastInboundAt ?? null });
          return;
        }
        const reason = err instanceof ApiError && err.code === "NETWORK_ERROR" ? "Sin conexión con el servidor" : "No se pudo enviar el mensaje";
        setMessages((prev) => failMessage(prev, cid, reason));
      }
    },
    [userId],
  );

  const update = useCallback(async (patch: Omit<UpdateConversationRequest, "lockVersion">): Promise<UpdateResult> => {
    const id = idRef.current;
    const current = convRef.current;
    if (!id || !current) return "error";
    try {
      const next = await conversationsApi.update(id, patch, current.lockVersion);
      if (idRef.current === id) {
        convRef.current = next;
        setConversation(next);
      }
      changedRef.current();
      return "ok";
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        await refresh();
        changedRef.current();
        return "conflict";
      }
      return "error";
    }
  }, [refresh]);

  const blocked =
    blockedAt !== null && blockedAt.id === conversationId && blockedAt.inbound === (conversation?.lastInboundAt ?? null);

  return { conversation, messages, hasOlder: olderCursor !== null, loading, loadingOlder, error, blocked, refresh, loadOlder, send, update };
}
