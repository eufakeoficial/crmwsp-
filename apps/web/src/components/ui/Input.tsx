import type { InputHTMLAttributes } from "react";
import { cx } from "./cx";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cx(
        "block min-h-10 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-900 placeholder:text-zinc-400",
        "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-emerald-600",
        "aria-[invalid=true]:border-red-500",
        "dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:focus-visible:outline-emerald-400",
        className,
      )}
      {...props}
    />
  );
}
