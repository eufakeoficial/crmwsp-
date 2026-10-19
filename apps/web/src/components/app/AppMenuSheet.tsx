"use client";

import { X } from "lucide-react";
import { useRef } from "react";
import { useDialogBehavior } from "@/lib/hooks/use-dialog";
import { type NavCounts, NavLinks } from "./AppSidebar";

/** Mobile menu: bottom sheet with every section. Escape closes it and focus is trapped. */
export function AppMenuSheet({ onClose, counts }: { onClose: () => void; counts?: NavCounts }) {
  const ref = useRef<HTMLDivElement>(null);
  useDialogBehavior(ref, onClose);
  return (
    <>
      <div aria-hidden onClick={onClose} className="fixed inset-0 z-[44] bg-ink/40 desk:hidden" />
      <div
        ref={ref}
        id="app-menu-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Menú"
        tabIndex={-1}
        className="fixed inset-x-0 bottom-0 z-[45] flex max-h-[85vh] flex-col gap-1 overflow-y-auto rounded-t-[28px] bg-ink px-3 pt-3.5 pb-6 outline-none desk:hidden"
      >
        <div className="flex items-center px-1.5 pb-2">
          <b className="flex-1 text-[18px] text-white">CRMWSP</b>
          <button type="button" onClick={onClose} aria-label="Cerrar menú" className="grid size-11 cursor-pointer place-items-center rounded-full bg-ink-2 text-white">
            <X aria-hidden className="size-5" />
          </button>
        </div>
        <nav aria-label="Principal" className="flex flex-col gap-1">
          <NavLinks onNavigate={onClose} {...(counts ? { counts } : {})} />
        </nav>
      </div>
    </>
  );
}
