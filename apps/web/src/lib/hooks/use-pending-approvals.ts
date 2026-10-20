"use client";

import { useEffect, useState } from "react";
import { aiApi } from "../ai-api";
import { APPROVALS_CHANGED } from "../ai-actions";

/** Number of AI actions waiting for approval (sidebar counter). Silent on errors: it is only a badge. */
export function usePendingApprovals(enabled: boolean, pollMs = 60_000): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!enabled) return setCount(0);
    let cancelled = false;
    const load = () =>
      aiApi.listActions("pending_approval").then((a) => !cancelled && setCount(a.length), () => undefined);
    void load();
    const timer = setInterval(load, pollMs);
    window.addEventListener(APPROVALS_CHANGED, load);
    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener(APPROVALS_CHANGED, load);
    };
  }, [enabled, pollMs]);
  return count;
}
