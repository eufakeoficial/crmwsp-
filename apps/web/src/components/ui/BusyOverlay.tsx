"use client";

import { useEffect, useState } from "react";
import { useBusyCount } from "@/lib/busy-overlay";

const SHOW_AFTER_MS = 250;
const MIN_VISIBLE_MS = 500;

/** Full-screen brand-blue "saving" screen for important writes. Appears only if the request takes a moment. */
export function BusyOverlay() {
  const busy = useBusyCount() > 0;
  const [visible, setVisible] = useState(false);
  const [shownAt, setShownAt] = useState(0);

  useEffect(() => {
    if (busy && !visible) {
      const t = setTimeout(() => {
        setShownAt(Date.now());
        setVisible(true);
      }, SHOW_AFTER_MS);
      return () => clearTimeout(t);
    }
    if (!busy && visible) {
      const t = setTimeout(() => setVisible(false), Math.max(0, MIN_VISIBLE_MS - (Date.now() - shownAt)));
      return () => clearTimeout(t);
    }
    return undefined;
  }, [busy, visible, shownAt]);

  if (!visible) return null;
  return (
    <div role="status" aria-live="polite" aria-label="Guardando" className="fixed inset-0 z-[90] flex flex-col items-center justify-center gap-4 bg-royal text-white">
      <span aria-hidden className="size-12 animate-spin rounded-full border-4 border-white/30 border-t-white" />
      <p className="m-0 text-base font-bold">Guardando…</p>
    </div>
  );
}
