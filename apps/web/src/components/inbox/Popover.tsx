"use client";

import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { cn } from "@/lib/cn";

/** Small dropdown anchored to its trigger. Closes on outside click and Escape. */
export function Popover({
  label,
  trigger,
  children,
  align = "left",
  triggerClassName,
  panelClassName,
  disabled = false,
}: {
  label: string;
  trigger: ReactNode;
  children: (close: () => void) => ReactNode;
  align?: "left" | "right";
  triggerClassName?: string | undefined;
  panelClassName?: string | undefined;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={root} className="relative flex-none">
      <button
        type="button"
        aria-label={label}
        title={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "inline-flex h-9 min-w-9 cursor-pointer items-center justify-center gap-1 rounded-full bg-paper px-2.5 text-[13px] font-bold text-ink hover:bg-line disabled:cursor-not-allowed disabled:opacity-50",
          open && "bg-line",
          triggerClassName,
        )}
      >
        {trigger}
      </button>
      {open ? (
        <div
          id={panelId}
          role="dialog"
          aria-label={label}
          className={cn(
            "absolute top-full z-30 mt-1.5 max-h-[70vh] min-w-56 overflow-y-auto rounded-2xl border border-line bg-white p-2 shadow-[0_12px_32px_rgba(18,18,18,.18)]",
            align === "right" ? "right-0" : "left-0",
            panelClassName,
          )}
        >
          {children(() => setOpen(false))}
        </div>
      ) : null}
    </div>
  );
}

/** Row inside a Popover menu. */
export function MenuItem({ children, onClick, disabled, active }: { children: ReactNode; onClick: () => void; disabled?: boolean; active?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex w-full cursor-pointer items-center gap-2 rounded-xl px-2.5 py-2 text-left text-[13px] font-semibold text-ink hover:bg-paper disabled:cursor-not-allowed disabled:opacity-50",
        active && "bg-lime-soft",
      )}
    >
      {children}
    </button>
  );
}
