"use client";

import { X } from "lucide-react";
import { type ReactNode, useId, useRef } from "react";
import { useDialogBehavior } from "@/lib/hooks/use-dialog";

export interface PanelField {
  label: string;
  value: ReactNode;
}

/** Right-hand detail drawer: row fields and a footer with actions. */
export function SidePanel({ title, fields, actions, footnote, onClose }: { title: string; fields: readonly PanelField[]; actions?: ReactNode; footnote?: string; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useDialogBehavior(ref, onClose);
  return (
    <>
      <div onClick={onClose} aria-hidden className="fixed inset-0 z-40 bg-ink/30" />
      <aside ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className="fixed top-3 right-3 bottom-3 z-[41] flex w-[min(480px,calc(100vw-24px))] flex-col overflow-hidden rounded-3xl bg-white shadow-[0_20px_60px_rgba(18,18,18,.3)]">
        <div className="flex items-center gap-2.5 border-b border-line p-4">
          <b id={titleId} className="flex-1 text-[17px]">{title}</b>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="grid size-10 cursor-pointer place-items-center rounded-full bg-paper text-ink">
            <X aria-hidden className="size-[18px]" />
          </button>
        </div>
        <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-4">
          {fields.map((f) => (
            <div key={f.label} className="flex justify-between gap-3 border-b border-paper py-2">
              <span className="text-muted">{f.label}</span>
              <b className="text-right">{f.value}</b>
            </div>
          ))}
          {footnote ? <span className="text-xs text-muted">{footnote}</span> : null}
        </div>
        {actions ? <div className="flex flex-wrap gap-2 border-t border-line px-4 py-3">{actions}</div> : null}
      </aside>
    </>
  );
}
