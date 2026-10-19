import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export function chipClasses(active: boolean, className?: string): string {
  return cn(
    "inline-flex h-9 flex-none cursor-pointer items-center rounded-full border-[1.5px] px-3.5 text-[13px] font-bold whitespace-nowrap",
    active ? "border-ink bg-ink text-white" : "border-line-2 bg-white text-ink hover:border-ink",
    className,
  );
}

/** Toggle chip (filter): black when active. */
export function Chip({
  active = false,
  className,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return <button type={type} aria-pressed={active} className={chipClasses(active, className)} {...props} />;
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
      className="h-9 cursor-pointer rounded-full border-[1.5px] border-line-2 bg-white px-2.5 text-[13px] font-bold text-ink"
    >
      {options.map((o) => (
        <option key={o}>{o}</option>
      ))}
    </select>
  );
}
