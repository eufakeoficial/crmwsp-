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
    <div className={cn("flex items-center gap-3 rounded-[18px] bg-white p-3.5", className)}>
      <span className={cn("grid size-11 flex-none place-items-center rounded-[14px]", TONE_SOFT[tone])}>
        <Icon aria-hidden className="size-5" />
      </span>
      <span className="min-w-0">
        <span className="block text-xs text-muted">{label}</span>
        <b className="block truncate text-[20px]">{value}</b>
        {note ? <span className="block text-xs text-muted">{note}</span> : null}
      </span>
    </div>
  );
}
