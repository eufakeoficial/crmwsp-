import { cn } from "@/lib/cn";
import { TONE_SOFT, type Tone } from "./tones";

/** Known status labels and their colour. Extend as new modules appear. */
export const STATUS_TONES: Readonly<Record<string, Tone>> = {
  Borrador: "paper",
  Enviada: "info",
  "Pidió cambios": "warning",
  Vencida: "danger",
  Aprobada: "success",
  Pagado: "success",
  Pendiente: "paper",
  "En revisión": "warning",
  Rechazado: "danger",
  Conectado: "success",
  Error: "danger",
  Nueva: "lime",
};

/** Status pill. Without an explicit tone it is looked up in `STATUS_TONES`. */
export function StatusChip({ label, tone, className }: { label: string; tone?: Tone; className?: string }) {
  const resolved = tone ?? STATUS_TONES[label] ?? "paper";
  return (
    <span className={cn("rounded-full px-[9px] py-0.5 text-xs font-extrabold whitespace-nowrap", TONE_SOFT[resolved], className)}>
      {label}
    </span>
  );
}
