"use client";

import { type FormEvent, useState } from "react";
import { Alert, Button, Card, Input, Label, OptionCard, Spinner, Textarea, Toast } from "@/components/ui";
import { aiApi } from "@/lib/ai-api";
import { AI_MODES, type AgentConfig, type AiMode } from "@crmwsp/contracts";
import { fromMinor, toMinor } from "@/lib/ai-validation";
import { useToast } from "@/lib/hooks/use-toast";
import { errorMessage } from "@/lib/messages";

const MODE_LABELS: Record<AiMode, { title: string; hint: string }> = {
  off: { title: "Apagado", hint: "La IA no interviene." },
  assist: { title: "Asistente", hint: "Redacta y tú envías." },
  auto: { title: "Automático", hint: "Responde sola dentro de las reglas." },
};

/** "Comportamiento del agente": default mode, confidence slider, approval threshold and business prompt. */
export function AgentBehavior({ config, currency, canEdit, onSaved }: { config: AgentConfig; currency: string; canEdit: boolean; onSaved: (c: AgentConfig) => void }) {
  const [mode, setMode] = useState<AiMode>(config.aiModeDefault);
  const [confidence, setConfidence] = useState(config.confidenceThreshold);
  const [approval, setApproval] = useState(fromMinor(config.approvalThresholdMinor, currency));
  const [prompt, setPrompt] = useState(config.systemPrompt);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const { message, show } = useToast();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    // Empty = no approval threshold.
    const minor = approval.trim() ? toMinor(approval, currency) : null;
    if (minor === undefined) return setError("El umbral de aprobación debe ser un importe válido.");
    setBusy(true);
    setError(undefined);
    try {
      onSaved(await aiApi.saveAgentConfig({ systemPrompt: prompt, aiModeDefault: mode, confidenceThreshold: confidence, approvalThresholdMinor: minor }));
      show("Comportamiento guardado");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="sm:p-6">
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <h2 className="m-0 text-[19px]">Comportamiento del agente</h2>
        <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
          <legend className="mb-2 text-sm font-bold">Modo por defecto en conversaciones nuevas</legend>
          <div role="radiogroup" className="grid gap-3 sm:grid-cols-3">
            {AI_MODES.map((m) => (
              <OptionCard key={m} mode="radio" selected={mode === m} onSelect={() => canEdit && setMode(m)} className={canEdit ? "" : "cursor-not-allowed opacity-70"}>
                <b className="block">{MODE_LABELS[m].title}</b>
                <span className="text-sm text-ink-3">{MODE_LABELS[m].hint}</span>
              </OptionCard>
            ))}
          </div>
        </fieldset>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ai-confidence">Umbral de confianza: {Math.round(confidence * 100)} %</Label>
          <input id="ai-confidence" type="range" min={0} max={1} step={0.05} value={confidence} disabled={!canEdit} onChange={(e) => setConfidence(Number(e.target.value))} className="w-full accent-ink" />
          <span className="text-xs text-muted">Por debajo de este nivel, la IA deriva la conversación a una persona.</span>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ai-approval">Aprobación de presupuestos desde ({currency})</Label>
          <Input id="ai-approval" inputMode="decimal" value={approval} disabled={!canEdit} onChange={(e) => setApproval(e.target.value)} className="sm:max-w-[240px]" />
          <span className="text-xs text-muted">Los presupuestos de este importe o más esperan tu aprobación antes de enviarse.</span>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ai-prompt">Prompt del negocio</Label>
          <Textarea id="ai-prompt" rows={5} value={prompt} disabled={!canEdit} onChange={(e) => setPrompt(e.target.value)} />
          <span className="text-xs text-muted">Tono, horarios, qué no debe prometer. La IA solo da precios, stock y plazos que estén en Conocimiento.</span>
        </div>
        <Alert>{error}</Alert>
        {canEdit ? <div><Button type="submit" variant="accent" disabled={busy}>{busy ? <Spinner /> : null}Guardar comportamiento</Button></div> : null}
      </form>
      <Toast message={message} />
    </Card>
  );
}
