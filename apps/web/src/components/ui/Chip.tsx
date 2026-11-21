import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

/** Row of chips/tabs: one scrollable line on mobile (no page scroll), wraps from `sm` up. */
export const CHIP_ROW = "no-scrollbar -mx-1 flex items-center gap-2 overflow-x-auto px-1 py-1 sm:flex-wrap";

export function chipClasses(active: boolean, className?: string): string {
  return cn(
    "inline-flex min-h-9 flex-none cursor-pointer items-center justify-center gap-2 rounded-full border-[1.5px] px-4 py-1.5 text-sm whitespace-nowrap no-underline transition-colors",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-royal",
    active
      ? "border-royal bg-royal font-semibold text-white shadow-sm"
      : "border-line-2 bg-paper font-medium text-ink hover:border-royal hover:bg-royal-soft",
    className,
  );
}

/** Filter pill (toggle button). Solid brand blue when active; optional `count` badge. */
export function Chip({
  active = false,
  count,
  className,
  type = "button",
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean; count?: number }) {
  return (
    <button type={type} aria-pressed={active} className={chipClasses(active, className)} {...props}>
      {children}
      {count === undefined ? null : (
        <span
          className={cn(
            "min-w-5 rounded-full px-1.5 text-center text-xs leading-5 font-semibold",
            active ? "bg-white/20 text-white" : "bg-line-2 text-ink",
          )}
        >
          {count}
        </span>
      )}
    </button>
  );
}

/** Pill-shaped native select (city, category...). */
export function PillSelect({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly string[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-9 cursor-pointer rounded-full border-[1.5px] border-line-2 bg-paper px-4 text-sm font-medium text-ink hover:border-royal"
    >
      {options.map((o) => (
        <option key={o}>{o}</option>
      ))}
    </select>
  );
}
