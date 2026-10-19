import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/** Black confirmation card with a lime circle: "Listo", "Gracias"... */
export function SuccessCard({ icon: Icon, className, children }: { icon: LucideIcon; className?: string; children: ReactNode }) {
  return (
    <div className={cn("flex flex-col items-start gap-3 rounded-[28px] bg-ink p-7 text-white", className)}>
      <span className="grid size-16 place-items-center rounded-full bg-lime text-ink">
        <Icon aria-hidden className="size-8" />
      </span>
      {children}
    </div>
  );
}
