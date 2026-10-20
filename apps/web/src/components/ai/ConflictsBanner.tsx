import { AlertTriangle } from "lucide-react";
import type { KnowledgeConflict } from "@crmwsp/contracts";
import { formatMoneyMinor } from "@/lib/format";

/** Same item with different prices across sources: the AI hands those quotes to a human. */
export function ConflictsBanner({ conflicts }: { conflicts: KnowledgeConflict[] }) {
  return (
    <section id="conflicts" aria-labelledby="conflicts-title" className="rounded-[22px] bg-warning-soft p-[18px] text-warning">
      <h2 id="conflicts-title" className="m-0 flex items-center gap-2 text-[17px]">
        <AlertTriangle aria-hidden className="size-5" />
        {conflicts.length === 1 ? "1 conflicto de precio" : `${conflicts.length} conflictos de precio`}
      </h2>
      <p className="mt-1 mb-3 text-sm">Mientras haya conflicto, la IA no dará ese precio y derivará a una persona. Revisa y borra o corrige la fuente desactualizada.</p>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {conflicts.map((c) => (
          <li key={c.key} className="rounded-2xl bg-white p-3 text-ink">
            <b className="block">{c.key}</b>
            <ul className="m-0 mt-1 list-none p-0 text-sm text-ink-3">
              {c.sources.map((s) => (
                <li key={s.sourceId}>{s.title}: <b>{formatMoneyMinor(s.priceMinor, s.currency)}</b></li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
      <a href="#sources" className="mt-3 inline-block text-sm font-bold text-warning underline">Revisar fuentes</a>
    </section>
  );
}
