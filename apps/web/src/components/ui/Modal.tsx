"use client";

import { X } from "lucide-react";
import { type ReactNode, useId, useRef } from "react";
import { useDialogBehavior } from "@/lib/hooks/use-dialog";

/** Generic centered dialog: title, free content and an optional footer with actions. */
export function Modal({
  title,
  children,
  footer,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useDialogBehavior(ref, onClose);
  return (
    <div onMouseDown={(e) => e.target === e.currentTarget && onClose()} className="fixed inset-0 z-[70] flex items-center justify-center bg-ink/50 p-3">
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`flex max-h-[calc(100dvh-24px)] w-full flex-col overflow-hidden rounded-3xl bg-white ${wide ? "max-w-[620px]" : "max-w-[440px]"}`}
      >
        <div className="flex items-center gap-2.5 border-b border-line p-4">
          <b id={titleId} className="flex-1 text-[18px]">{title}</b>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="grid size-10 cursor-pointer place-items-center rounded-full bg-paper text-ink">
            <X aria-hidden className="size-[18px]" />
          </button>
        </div>
        <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">{children}</div>
        {footer ? <div className="flex flex-wrap justify-end gap-2 border-t border-line px-4 py-3">{footer}</div> : null}
      </div>
    </div>
  );
}
