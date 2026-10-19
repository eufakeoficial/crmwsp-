import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/** Always rendered (empty when there is no message) so screen readers announce changes via aria-live. */
export function Alert({ children, tone = "error" }: { children?: ReactNode; tone?: "error" | "info" }) {
  return (
    <div aria-live="polite" role={children ? (tone === "error" ? "alert" : "status") : undefined}>
      {children ? (
        <p
          className={cn(
            "rounded-2xl px-4 py-3 text-sm font-semibold",
            tone === "error" ? "bg-danger-soft text-danger" : "bg-info-soft text-info",
          )}
        >
          {children}
        </p>
      ) : null}
    </div>
  );
}
