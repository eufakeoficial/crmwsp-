import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/** Selectable card: black border and soft lime background when chosen. */
export function OptionCard({
  selected,
  onSelect,
  mode = "pressed",
  className,
  children,
}: {
  selected: boolean;
  onSelect: () => void;
  mode?: "pressed" | "radio" | "checkbox";
  className?: string;
  children: ReactNode;
}) {
  const pressed = mode === "pressed";
  return (
    <button
      type="button"
      role={pressed ? undefined : mode}
      aria-pressed={pressed ? selected : undefined}
      aria-checked={pressed ? undefined : selected}
      onClick={onSelect}
      className={cn("cursor-pointer rounded-[18px] border-2 p-4 text-left text-ink", selected ? "border-royal bg-royal-soft" : "border-line bg-white", className)}
    >
      {children}
    </button>
  );
}
