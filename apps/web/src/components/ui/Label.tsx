import type { LabelHTMLAttributes } from "react";
import { cx } from "./cx";

export function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cx("block text-sm font-medium text-zinc-800 dark:text-zinc-200", className)} {...props} />;
}
