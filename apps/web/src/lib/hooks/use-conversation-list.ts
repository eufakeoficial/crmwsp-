"use client";

import type { Conversation, ConversationStatus } from "@crmwsp/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { type AssigneeFilter, conversationsApi } from "../inbox-api";

const PAGE = 25;

export interface ConversationFilters {
  status: ConversationStatus;
  assignedTo: AssigneeFilter;
}

/** Cursor-paginated conversation list. `refresh` reloads everything already loaded in one request. */
export function useConversationList(tenantId: string | null, filters: ConversationFilters) {
  const [items, setItems] = useState<Conversation[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const seq = useRef(0);
  const count = useRef(PAGE);
  const { status, assignedTo } = filters;

  const fetchFirst = useCallback(
    async (limit: number, initial: boolean) => {
      const mine = ++seq.current;
      if (initial) setLoading(true);
      try {
        const res = await conversationsApi.list({ status, assignedTo, limit: Math.min(100, limit) });
        if (mine !== seq.current) return;
        setItems(res.items);
        setNextCursor(res.nextCursor);
        count.current = Math.max(PAGE, res.items.length);
        setError(null);
      } catch (err) {
        if (mine === seq.current) setError(err);
      } finally {
        if (mine === seq.current) setLoading(false);
      }
    },
    [status, assignedTo],
  );

  useEffect(() => {
    if (tenantId === null) return;
    seq.current++;
    count.current = PAGE;
    setItems([]);
    setNextCursor(null);
    void fetchFirst(PAGE, true);
  }, [tenantId, fetchFirst]);

  const refresh = useCallback(() => fetchFirst(count.current, false), [fetchFirst]);

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    const mine = seq.current;
    setLoadingMore(true);
    try {
      const res = await conversationsApi.list({ status, assignedTo, cursor: nextCursor, limit: PAGE });
      // A filter/tenant change or a refresh started meanwhile: this page belongs to a stale list.
      if (mine !== seq.current) return;
      setItems((prev) => [...prev, ...res.items.filter((c) => !prev.some((p) => p.id === c.id))]);
      setNextCursor(res.nextCursor);
      count.current += res.items.length;
    } catch (err) {
      if (mine === seq.current) setError(err);
    } finally {
      setLoadingMore(false);
    }
  }, [nextCursor, loadingMore, status, assignedTo]);

  return { items, nextCursor, loading, loadingMore, error, refresh, loadMore };
}
