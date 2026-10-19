"use client";

import { useEffect, useRef } from "react";

/**
 * Focus handling for a non-modal sheet: the element (with `tabIndex={-1}`) receives focus
 * on mount and focus returns to the opener on unmount.
 */
export function useDialogFocus<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    ref.current?.focus({ preventScroll: true });
    return () => opener?.focus({ preventScroll: true });
  }, []);
  return ref;
}
