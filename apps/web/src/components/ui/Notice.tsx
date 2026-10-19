import { Info, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/** Blue information notice. */
export function Notice({ children }: { children: ReactNode }) {
  return (
    <div className="flex gap-2.5 rounded-[18px] bg-info-soft p-3.5 text-[15px] text-info">
      <Info aria-hidden className="size-5 flex-none" />
      <span>{children}</span>
    </div>
  );
}

const TONES = { warning: "bg-warning-soft text-warning", danger: "bg-danger-soft text-danger" } as const;

/** Request status: "En revisión" (amber) or "Rechazado" (red). Errors are announced. */
export function StatusCard({ tone, icon: Icon, title, alert = false, children }: { tone: keyof typeof TONES; icon: LucideIcon; title: string; alert?: boolean; children: ReactNode }) {
  return (
    <div role={alert ? "alert" : undefined} className={cn("flex gap-3.5 rounded-[22px] p-[18px]", TONES[tone])}>
      <span className="grid size-11 flex-none place-items-center rounded-full bg-white">
        <Icon aria-hidden className="size-5" />
      </span>
      <div>
        <b className="block text-[17px]">{title}</b>
        <span>{children}</span>
      </div>
    </div>
  );
}
