import type { HTMLAttributes } from "react";
import { cx } from "./cx";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cx(
        "rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900",
        className,
      )}
      {...props}
    />
  );
}
