import { ExternalLink } from "lucide-react";
import type { AiProvider } from "@/lib/ai-schemas";
import { PROVIDER_GUIDES } from "./provider-guides";

/** Step 2: numbered guide to get an API key for the chosen provider. */
export function KeyGuide({ provider }: { provider: AiProvider }) {
  const g = PROVIDER_GUIDES[provider];
  return (
    <div className="flex flex-col gap-3">
      <ol className="m-0 flex list-none flex-col gap-2 p-0">
        {g.steps.map((text, i) => (
          <li key={text} className="flex items-start gap-3 text-sm">
            <span aria-hidden className="grid size-7 flex-none place-items-center rounded-full bg-lime text-[13px] font-extrabold text-ink">{i + 1}</span>
            <span className="pt-0.5">{text}</span>
          </li>
        ))}
      </ol>
      {g.keyUrl ? (
        <a
          href={g.keyUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex w-fit items-center gap-2 rounded-full border-[1.5px] border-ink bg-white px-4 py-2 text-sm font-bold text-ink no-underline hover:bg-paper"
        >
          Abrir {g.keyLabel}
          <ExternalLink aria-hidden className="size-4" />
          <span className="sr-only">(se abre en otra pestaña)</span>
        </a>
      ) : null}
      <p className="m-0 rounded-2xl bg-paper-2 px-4 py-3 text-sm text-ink-3">
        <b>Saldo y pago:</b> {g.billing} <b>Coste orientativo:</b> {g.costNote}
      </p>
    </div>
  );
}
