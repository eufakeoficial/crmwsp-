import { Input, Label } from "@/components/ui";
import type { AiUsage } from "@crmwsp/contracts";
import { UsageMeter } from "./UsageMeter";

export const CURRENCIES = ["EUR", "USD", "GBP", "MXN", "ARS", "COP", "CLP"] as const;

/** Step 4: monthly spend limit + consumption bar. */
export function BudgetFields({
  budget, currency, usage, disabled, onBudget, onCurrency,
}: {
  budget: string; currency: string; usage: AiUsage | null; disabled: boolean;
  onBudget: (v: string) => void; onCurrency: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ai-budget">Límite de gasto mensual</Label>
          <Input id="ai-budget" inputMode="decimal" placeholder="Ej. 20" value={budget} disabled={disabled} onChange={(e) => onBudget(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ai-currency">Moneda</Label>
          <select id="ai-currency" value={currency} disabled={disabled} onChange={(e) => onCurrency(e.target.value)} className="h-12 rounded-[14px] border-[1.5px] border-ink bg-white px-3 text-[16px] disabled:opacity-50">
            {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
          </select>
        </div>
      </div>
      <UsageMeter usage={usage} />
    </div>
  );
}
