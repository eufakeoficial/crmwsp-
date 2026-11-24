"use client";

import type { UnansweredQuote, UnansweredQuoteCounts } from "@crmwsp/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { quotesApi } from "@/lib/quotes-api";
import { appendQuotes, withoutQuote } from "./unanswered-quotes-meta";

const PAGE = 25;

/**
 * Cursor-paginated "quotes without an answer" list (GET /quotes/unanswered). Idle while `enabled` is
 * false. `refresh` reloads everything already loaded in one request; `retry` starts over.
 */
export function useUnansweredQuotes(tenantId: string | null, enabled: boolean) {
  const [items, setItems] = useState<UnansweredQuote[]>([]);
  const [counts, setCounts] = useState<UnansweredQuoteCounts | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const seq = useRef(0);
  const count = useRef(PAGE);

  const fetchFirst = useCallback(
    async (limit: number, initial: boolean) => {
      if (!enabled || tenantId === null) return;
      const mine = ++seq.current;
      if (initial) setLoading(true);
      try {
        const res = await quotesApi.unanswered({ limit: Math.min(100, limit) });
        if (mine !== seq.current) return;
        setItems(res.items);
        setCounts(res.counts);
        setNextCursor(res.nextCursor);
        count.current = Math.max(PAGE, res.items.length);
        setError(null);
      } catch (err) {
        if (mine === seq.current) setError(err);
      } finally {
        if (mine === seq.current) setLoading(false);
      }
    },
    [enabled, tenantId],
  );

  useEffect(() => {
    seq.current++;
    count.current = PAGE;
    setItems([]);
    setCounts(null);
    setNextCursor(null);
    setError(null);
    setLoading(enabled && tenantId !== null);
    if (enabled) void fetchFirst(PAGE, true);
  }, [enabled, tenantId, fetchFirst]);

  const refresh = useCallback(() => fetchFirst(count.current, false), [fetchFirst]);
  const retry = useCallback(() => fetchFirst(PAGE, true), [fetchFirst]);
  const remove = useCallback((quoteId: string) => setItems((prev) => withoutQuote(prev, quoteId)), []);

  const loadMore = useCallback(async () => {
    if (!enabled || !nextCursor || loadingMore) return;
    const mine = seq.current;
    setLoadingMore(true);
    try {
      const res = await quotesApi.unanswered({ cursor: nextCursor, limit: PAGE });
      if (mine !== seq.current) return;
      setItems((prev) => appendQuotes(prev, res.items));
      setNextCursor(res.nextCursor);
      count.current += res.items.length;
    } catch (err) {
      if (mine === seq.current) setError(err);
    } finally {
      setLoadingMore(false);
    }
  }, [enabled, nextCursor, loadingMore]);

  return { items, counts, nextCursor, loading, loadingMore, error, refresh, retry, remove, loadMore };
}
