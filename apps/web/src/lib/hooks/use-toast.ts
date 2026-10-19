"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** Short confirmation message that clears itself: `show("Copiado")`. */
export function useToast(durationMs = 2200) {
  const [message, setMessage] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const show = useCallback(
    (text: string) => {
      clearTimeout(timer.current);
      setMessage(text);
      timer.current = setTimeout(() => setMessage(""), durationMs);
    },
    [durationMs],
  );

  useEffect(() => () => clearTimeout(timer.current), []);
  return { message, show };
}
