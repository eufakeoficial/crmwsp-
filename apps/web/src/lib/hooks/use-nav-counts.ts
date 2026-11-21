"use client";

import { useEffect, useState } from "react";
import { aiRunsApi } from "../ai-runs-api";
import { paymentReviewsApi } from "../payment-reviews-api";

export interface ListNavCounts {
  readonly "payment-reviews": number;
  readonly "ai-handoffs": number;
}

const ZERO: ListNavCounts = { "payment-reviews": 0, "ai-handoffs": 0 };

/**
 * Sidebar counters fed by list endpoints (no count endpoint exists): pending payment reviews
 * (`GET /payment-reviews?status=pending`) and AI handoffs (`GET /ai/handoffs`, first page).
 * Refreshes every `pollMs` and when the tab regains focus. Silent on errors: it is only a badge.
 */
export function useNavCounts(opts: { reviews: boolean; handoffs: boolean }, pollMs = 60_000): ListNavCounts {
  const [counts, setCounts] = useState<ListNavCounts>(ZERO);
  const { reviews, handoffs } = opts;
  useEffect(() => {
    if (!reviews && !handoffs) return setCounts(ZERO);
    let cancelled = false;
    const load = () => {
      if (reviews) {
        paymentReviewsApi.list("pending").then(
          (r) => !cancelled && setCounts((c) => ({ ...c, "payment-reviews": r.items.length })),
          () => undefined,
        );
      }
      if (handoffs) {
        aiRunsApi.handoffs().then(
          (r) => !cancelled && setCounts((c) => ({ ...c, "ai-handoffs": r.items.length })),
          () => undefined,
        );
      }
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") load();
    };
    load();
    const timer = setInterval(load, pollMs);
    window.addEventListener("focus", load);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener("focus", load);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [reviews, handoffs, pollMs]);
  return counts;
}
