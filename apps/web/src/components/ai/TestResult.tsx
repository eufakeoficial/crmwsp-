import { Check, X } from "lucide-react";
import type { AiTestResult } from "@crmwsp/contracts";

const ROWS = [
  { key: "structuredOutput", label: "Salida estructurada", off: "Sin ella la IA no puede proponer acciones (presupuestos, etiquetas): solo redactará respuestas." },
  { key: "embeddings", label: "Embeddings", off: "Sin embeddings la búsqueda en tu conocimiento usa coincidencia de texto, menos precisa." },
  { key: "transcription", label: "Transcripción de audio", off: "Sin transcripción, los audios de clientes no se convierten en texto para la IA." },
] as const;

/** Latency and capabilities (check / cross) with what gets disabled when one is missing. */
export function TestResult({ result }: { result: AiTestResult }) {
  return (
    <div className="flex flex-col gap-2 rounded-[18px] bg-paper-2 p-4" role="status">
      <p className="m-0 text-sm font-bold">
        {result.ok ? (result.latencyMs > 0 ? `Conexión correcta · ${Math.round(result.latencyMs)} ms` : "Última prueba correcta") : `No se pudo conectar${result.error ? `: ${result.error}` : "."}`}
      </p>
      {result.ok ? (
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
          {ROWS.map((r) => {
            const on = result.capabilities[r.key];
            const Icon = on ? Check : X;
            return (
              <li key={r.key} className="flex items-start gap-2 text-sm">
                <Icon aria-hidden className={on ? "mt-0.5 size-4 flex-none text-success" : "mt-0.5 size-4 flex-none text-danger"} />
                <span>
                  <b>{r.label}</b> {on ? "disponible" : "no disponible"}
                  {on ? null : <span className="block text-muted">{r.off}</span>}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
