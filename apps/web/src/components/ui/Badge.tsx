import { BadgeCheck } from "lucide-react";
import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

type BadgeTone = "verified" | "new" | "neutral";

const TONES: Record<BadgeTone, string> = {
  verified: "bg-ink text-white",
  new: "bg-lime text-ink",
  neutral: "border border-line bg-white text-ink",
};

/** Pill badge: "Verificado" (black, lime check), "Nuevo" (lime) or neutral. */
export function Badge({
  tone = "neutral",
  className,
  children,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-[3px] rounded-full px-2.5 py-0.5 text-xs font-bold whitespace-nowrap",
        tone === "verified" && "pl-1.5",
        TONES[tone],
        className,
      )}
      {...props}
    >
      {tone === "verified" ? <BadgeCheck aria-hidden className="size-3.5 text-lime" /> : null}
      {children}
    </span>
  );
}
