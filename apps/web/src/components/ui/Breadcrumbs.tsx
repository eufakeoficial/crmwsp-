import { ChevronRight } from "lucide-react";
import Link from "next/link";

export function Breadcrumbs({ items }: { items: readonly { label: string; href?: string }[] }) {
  return (
    <nav aria-label="Ruta de navegación">
      <ol className="m-0 flex list-none flex-wrap items-center gap-1 p-0 text-sm text-muted">
        {items.map((item, i) => (
          <li key={item.label} className="flex items-center gap-1">
            {i > 0 ? <ChevronRight aria-hidden className="size-3.5" /> : null}
            {item.href && i < items.length - 1 ? (
              <Link href={item.href} className="text-ink-3 hover:underline">{item.label}</Link>
            ) : (
              <span aria-current={i === items.length - 1 ? "page" : undefined} className="font-bold text-ink">{item.label}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
