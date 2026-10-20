import { budgetLevel, budgetPercent } from "@/lib/ai-validation";
import type { AiUsage } from "@/lib/ai-schemas";
import { cn } from "@/lib/cn";
import { formatMoney } from "@/lib/format";

const BAR = { ok: "bg-success", warn: "bg-amber-ink", exceeded: "bg-danger" } as const;
const MESSAGE = {
  ok: null,
  warn: "Has consumido más del 80 % de tu límite mensual.",
  exceeded: "Has llegado al 100 %: la IA automática está apagada hasta el mes que viene o hasta que subas el límite. El inbox sigue funcionando.",
} as const;

/** Month consumption bar with the 80 % / 100 % rules. */
export function UsageMeter({ usage }: { usage: AiUsage | null }) {
  if (!usage) return <p className="m-0 text-sm text-muted" aria-busy="true">Cargando consumo…</p>;
  const pct = budgetPercent(usage.spentMinor, usage.budgetMinor);
  const level = budgetLevel(pct);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
        <span><b>{formatMoney(usage.spentMinor / 100, usage.currency)}</b> gastados este mes</span>
        <span className="text-muted">
          {usage.budgetMinor ? `de ${formatMoney(usage.budgetMinor / 100, usage.currency)} (${pct} %)` : "Sin límite fijado"}
        </span>
      </div>
      <div
        role="progressbar"
        aria-label="Consumo mensual de IA"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.min(pct ?? 0, 100)}
        className="h-3 overflow-hidden rounded-full bg-paper"
      >
        <div className={cn("h-full rounded-full transition-[width]", BAR[level])} style={{ width: `${Math.min(pct ?? 0, 100)}%` }} />
      </div>
      {MESSAGE[level] ? <p role="status" className="m-0 text-sm font-semibold text-warning">{MESSAGE[level]}</p> : null}
      <p className="m-0 text-xs text-muted">Al 80 % avisamos; al 100 % la IA automática se apaga, el inbox nunca.</p>
    </div>
  );
}
