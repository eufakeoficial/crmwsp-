import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { TONE_SOFT, type Tone } from "./tones";

/** Metric card: tinted icon box, label and a large value. */
export function KpiCard({
  label,
  value,
  icon: Icon,
  tone = "lime-soft",
  note,
  className,
}: {
  label: string;
  value: string;
  icon: LucideIcon;
  tone?: Tone;
  note?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-2.5 rounded-[16px] bg-white p-3", className)}>
      <span className={cn("grid size-9 flex-none place-items-center rounded-[12px]", TONE_SOFT[tone])}>
        <Icon aria-hidden className="size-4" />
      </span>
      <span className="min-w-0">
        <span className="block text-xs text-muted">{label}</span>
        <b className="block truncate text-[17px]">{value}</b>
        {note ? <span className="block text-xs text-muted">{note}</span> : null}
      </span>
    </div>
  );
}
