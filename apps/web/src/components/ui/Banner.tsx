import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/** One-line notice: lime (tip, achievement) or blue (information). */
export function Banner({ tone = "lime", icon: Icon, children }: { tone?: "lime" | "info"; icon: LucideIcon; children: ReactNode }) {
  const lime = tone === "lime";
  return (
    <div className={cn("flex gap-2.5 rounded-[20px] px-4 py-3.5", lime ? "bg-lime font-bold text-ink" : "bg-info-soft text-info")}>
      <Icon aria-hidden className={cn("flex-none", lime ? "size-[22px]" : "size-5")} />
      <span>{children}</span>
    </div>
  );
}
