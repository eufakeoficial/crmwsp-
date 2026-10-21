"use client";

import type { InboxConversation, InboxCounts } from "@crmwsp/contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type InboxListParams, inboxV2Api } from "@/lib/inbox-v2-api";

const PAGE = 25;

/**
 * Cursor-paginated inbox list (GET /inbox/conversations). `refresh` reloads everything already
 * loaded in one request; filters are compared by value so callers can pass a fresh object.
 */
export function useInboxList(tenantId: string | null, params: InboxListParams) {
  const [items, setItems] = useState<InboxConversation[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const seq = useRef(0);
  const count = useRef(PAGE);
  const key = JSON.stringify(params);
  const stable = useMemo(() => params, [key]);

  const fetchFirst = useCallback(
    async (limit: number, initial: boolean) => {
      const mine = ++seq.current;
      if (initial) setLoading(true);
      try {
        const res = await inboxV2Api.list({ ...stable, limit: Math.min(100, limit) });
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
    [stable],
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
      const res = await inboxV2Api.list({ ...stable, cursor: nextCursor, limit: PAGE });
      if (mine !== seq.current) return;
      setItems((prev) => [...prev, ...res.items.filter((c) => !prev.some((p) => p.id === c.id))]);
      setNextCursor(res.nextCursor);
      count.current += res.items.length;
    } catch (err) {
      if (mine === seq.current) setError(err);
    } finally {
      setLoadingMore(false);
    }
  }, [nextCursor, loadingMore, stable]);

  return { items, nextCursor, loading, loadingMore, error, refresh, loadMore };
}

/** Folder badges (GET /inbox/counts). Fails soft: badges just stay as they were. */
export function useInboxCounts(tenantId: string | null) {
  const [counts, setCounts] = useState<InboxCounts | null>(null);
  const refresh = useCallback(async () => {
    try {
      setCounts(await inboxV2Api.counts());
    } catch {
      /* keep the previous badges */
    }
  }, []);
  useEffect(() => {
    setCounts(null);
    if (tenantId !== null) void refresh();
  }, [tenantId, refresh]);
  return { counts, refresh };
}
