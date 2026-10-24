import { cn } from "@/lib/cn";

/** On/off switch (role="switch"). */
export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (next: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn("relative h-7 w-12 flex-none cursor-pointer rounded-full transition-colors", checked ? "bg-royal" : "bg-subtle")}
    >
      <span aria-hidden className={cn("absolute top-1 size-5 rounded-full transition-all", checked ? "left-6 bg-lime" : "left-1 bg-white")} />
    </button>
  );
}
