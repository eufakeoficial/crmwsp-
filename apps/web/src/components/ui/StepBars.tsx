import { cn } from "@/lib/cn";

/** Segmented progress bar. Decorative: pair it with text such as "Paso 2 de 4". */
export function StepBars({ total, current, className }: { total: number; current: number; className?: string }) {
  return (
    <div aria-hidden className={cn("grid gap-1", className)} style={{ gridTemplateColumns: `repeat(${total}, minmax(0, 1fr))` }}>
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={cn("h-1.5 rounded-[3px]", i < current ? "bg-ink" : "bg-line")} />
      ))}
    </div>
  );
}
