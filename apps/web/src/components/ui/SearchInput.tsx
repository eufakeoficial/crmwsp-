import { Search } from "lucide-react";
import type { InputHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

/** White pill search with a round lime submit button. Wrap in a <form> to submit. */
export function SearchInput({
  className,
  label = "Buscar",
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & { label?: string }) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-full bg-white py-1.5 pr-1.5 pl-5 focus-within:outline-3 focus-within:outline-focus",
        className,
      )}
    >
      <input
        type="search"
        aria-label={label}
        className="min-w-0 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-muted"
        {...props}
      />
      <button
        type="submit"
        aria-label={label}
        className="inline-flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-full bg-lime text-ink hover:brightness-95"
      >
        <Search aria-hidden className="size-5" />
      </button>
    </div>
  );
}
