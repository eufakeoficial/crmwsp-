"use client";

import { Sparkles } from "lucide-react";
import { useToast } from "@/lib/hooks/use-toast";
import { Button } from "./Button";
import { Toast } from "./Toast";

export const AI_ASSIST_COPIED = "Prompt copiado: pégalo en tu asistente de IA (Claude, ChatGPT…)";

/** Legacy fallback for contexts without the async clipboard API. */
function legacyCopy(text: string): boolean {
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

/** "Hacerlo con IA": copies a ready-to-paste prompt (built from non-secret data only) to the clipboard. */
export function AiAssistButton({ prompt, label = "Hacerlo con IA", className }: { prompt: string; label?: string; className?: string }) {
  const { message, show } = useToast(4000);
  async function copy() {
    let ok = false;
    try {
      await navigator.clipboard.writeText(prompt);
      ok = true;
    } catch {
      ok = legacyCopy(prompt);
    }
    show(ok ? AI_ASSIST_COPIED : "No se pudo copiar el prompt: inténtalo de nuevo");
  }
  return (
    <>
      <Button size="sm" variant="outline" className={className ?? "self-start"} onClick={() => void copy()} data-testid="ai-assist-button">
        <Sparkles aria-hidden className="size-4" />{label}
      </Button>
      <Toast message={message} tone={message === AI_ASSIST_COPIED ? "ok" : "warn"} />
    </>
  );
}
