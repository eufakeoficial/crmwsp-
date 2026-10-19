import type { ReactNode } from "react";
import { cx } from "./cx";

/** Always rendered (empty when there is no message) so screen readers announce changes via aria-live. */
export function Alert({ children, tone = "error" }: { children?: ReactNode; tone?: "error" | "info" }) {
  return (
    <div aria-live="polite" role={children ? (tone === "error" ? "alert" : "status") : undefined}>
      {children ? (
        <p
          className={cx(
            "rounded-md border px-3 py-2 text-sm",
            tone === "error"
              ? "border-red-300 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
              : "border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-200",
          )}
        >
          {children}
        </p>
      ) : null}
    </div>
  );
}
