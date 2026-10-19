import { Sparkles } from "lucide-react";

/** Floating lime "Asistente" button. Visual only for now (no handler wired). */
export function AssistantFab({ onOpen }: { onOpen?: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label="Abrir asistente de IA"
      className="fixed right-4 bottom-6 z-[35] flex h-14 cursor-pointer items-center gap-2.5 rounded-full bg-lime pr-5 pl-2 text-[15px] font-extrabold whitespace-nowrap text-ink shadow-[0_10px_28px_rgba(18,18,18,.25)]"
    >
      <span className="grid size-10 place-items-center rounded-full bg-ink text-lime">
        <Sparkles aria-hidden className="size-5" />
      </span>
      Asistente
    </button>
  );
}
