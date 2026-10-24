import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";

const BTN = "grid size-9 cursor-pointer place-items-center rounded-[10px] border-[1.5px] border-line-2 bg-white text-ink disabled:cursor-not-allowed disabled:opacity-50";

/** Summary on the left; previous, pages, next on the right. */
export function Pagination({ page, pageCount, onChange, summary }: { page: number; pageCount: number; onChange: (page: number) => void; summary: string }) {
  return (
    <nav aria-label="Paginación" className="flex items-center justify-between gap-3 text-muted">
      <span>{summary}</span>
      <div className="flex gap-1.5">
        <button type="button" aria-label="Página anterior" disabled={page <= 1} onClick={() => onChange(page - 1)} className={BTN}>
          <ChevronLeft aria-hidden className="size-4" />
        </button>
        {Array.from({ length: pageCount }, (_, i) => i + 1).map((n) => (
          <button
            key={n}
            type="button"
            aria-label={`Página ${n}`}
            aria-current={n === page ? "page" : undefined}
            onClick={() => onChange(n)}
            className={cn(BTN, n === page && "border-royal bg-royal font-extrabold text-white")}
          >
            {n}
          </button>
        ))}
        <button type="button" aria-label="Página siguiente" disabled={page >= pageCount} onClick={() => onChange(page + 1)} className={BTN}>
          <ChevronRight aria-hidden className="size-4" />
        </button>
      </div>
    </nav>
  );
}
