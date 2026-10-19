import { Check, Minus } from "lucide-react";
import { cn } from "@/lib/cn";

/** Table checkbox: black with a lime check. 44px touch target. */
export function CheckBox({ checked, onChange, label }: { checked: boolean | "mixed"; onChange: () => void; label: string }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={onChange}
      className="relative flex-none cursor-pointer p-0 after:absolute after:-inset-[11px] after:content-['']"
    >
      <span aria-hidden className={cn("grid size-[22px] place-items-center rounded-[7px] border-2 border-ink text-lime", checked ? "bg-ink" : "bg-white")}>
        {checked === "mixed" ? <Minus className="size-3.5" /> : checked ? <Check className="size-3.5" /> : null}
      </span>
    </button>
  );
}
