import { AlertTriangle } from "lucide-react";
import { OptionCard } from "@/components/ui";
import { AI_PROVIDERS, type AiProvider } from "@/lib/ai-schemas";
import { PROVIDER_GUIDES } from "./provider-guides";

/** Step 1: provider cards, the (disabled) SaaS credits alternative and the OpenCode Go warning. */
export function ProviderPicker({ value, onChange, disabled }: { value: AiProvider; onChange: (p: AiProvider) => void; disabled: boolean }) {
  return (
    <div className="flex flex-col gap-3">
      <div role="radiogroup" aria-label="Proveedor de IA" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {AI_PROVIDERS.map((p) => {
          const g = PROVIDER_GUIDES[p];
          return (
            <OptionCard key={p} mode="radio" selected={value === p} onSelect={() => !disabled && onChange(p)} className={disabled ? "cursor-not-allowed opacity-70" : ""}>
              <b className="block text-[16px]">{g.label}</b>
              {g.recommended ? <span className="mt-1 inline-block rounded-full bg-lime px-2 py-0.5 text-xs font-extrabold">Recomendado</span> : null}
              <span className="mt-1 block text-sm text-ink-3">{g.tagline}</span>
            </OptionCard>
          );
        })}
      </div>
      <div aria-disabled="true" className="flex flex-wrap items-center gap-3 rounded-[18px] border-2 border-dashed border-line-2 bg-paper-2 p-4 text-muted">
        <div className="min-w-0 flex-1">
          <b className="block text-ink-3">Usar créditos de CRMWSP</b>
          <span className="text-sm">Sin key propia: pagas por uso a través de CRMWSP, con límite mensual.</span>
        </div>
        <span className="rounded-full bg-paper px-3 py-1 text-xs font-extrabold text-ink-3">Próximamente</span>
      </div>
      <div role="note" className="flex gap-2.5 rounded-[18px] bg-warning-soft p-3.5 text-[14px] text-warning">
        <AlertTriangle aria-hidden className="mt-0.5 size-5 flex-none" />
        <span>
          <b>No admitimos suscripciones pensadas para programar (p. ej. OpenCode Go):</b> sus condiciones no permiten atención a clientes y podrían bloquear tu cuenta.
        </span>
      </div>
    </div>
  );
}
