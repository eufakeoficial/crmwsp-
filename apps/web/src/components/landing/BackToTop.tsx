"use client";

import { ArrowUp } from "lucide-react";
import { useEffect, useState } from "react";

/** Floating bottom-left button that scrolls back to the top once the visitor has scrolled down. */
export function BackToTop() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 600);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return (
    <button
      type="button"
      aria-label="Volver arriba"
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      className={`fixed bottom-5 left-5 z-40 grid size-12 place-items-center rounded-full bg-royal text-white shadow-[0_12px_30px_-10px_rgba(5,10,58,0.5)] transition-all duration-300 hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-royal ${visible ? "opacity-100" : "pointer-events-none translate-y-3 opacity-0"}`}
    >
      <ArrowUp className="size-5" aria-hidden />
    </button>
  );
}
