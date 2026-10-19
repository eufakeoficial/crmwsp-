import type { InputHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "block h-12 w-full rounded-[14px] border-[1.5px] border-ink bg-white px-3.5 text-[16px] text-ink placeholder:text-muted",
        "aria-[invalid=true]:border-danger disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}
