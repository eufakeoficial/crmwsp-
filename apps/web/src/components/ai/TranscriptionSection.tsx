"use client";

import { Mic, Plug, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Alert, Button, Card, Input, Label, Spinner } from "@/components/ui";
import { transcriptionApi } from "@/lib/ai-api";
import { errorMessage } from "@/lib/messages";
import { DEFAULT_TRANSCRIPTION_MODEL, DEFAULT_TRANSCRIPTION_MODELS, type AiTranscriptionStatus } from "@crmwsp/contracts";

const SOURCE_TEXT: Record<AiTranscriptionStatus["source"], string> = {
  dedicated: "Audios: activos (con esta conexión de transcripción)",
  chat: "Audios: activos (con tu proveedor principal)",
  none: "Audios: no disponibles",
};

/**
 * Optional second key used only to transcribe customers' voice notes (ADR 0024). The key lives
 * only in component state and is cleared after saving; the API returns only its last characters.
 */
export function TranscriptionSection({ canEdit }: { canEdit: boolean }) {
  const [status, setStatus] = useState<AiTranscriptionStatus | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState(DEFAULT_TRANSCRIPTION_MODEL);
  const [busy, setBusy] = useState<"save" | "test" | "remove" | null>(null);
  const [error, setError] = useState<string>();
  const [note, setNote] = useState<string>();

  const load = useCallback(async () => {
    try {
      const s = await transcriptionApi.get();
      setStatus(s);
      if (s.connection) setModel(s.connection.model);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const conn = status?.connection ?? null;

  async function run(kind: "save" | "test" | "remove", fn: () => Promise<string | undefined>) {
    setBusy(kind);
    setError(undefined);
    setNote(undefined);
    try {
      setNote(await fn());
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
    setBusy(null);
  }

  const save = () =>
    run("save", async () => {
      if (!conn && !apiKey.trim()) throw new Error("Pega una API key de OpenAI para activar los audios.");
      await transcriptionApi.save({ provider: "openai", model: model.trim() || DEFAULT_TRANSCRIPTION_MODEL, ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}) });
      setApiKey("");
      return "Guardada. Pulsa «Probar» para activarla.";
    });
  const test = () =>
    run("test", async () => {
      const r = await transcriptionApi.test();
      return r.ok
        ? "Funciona: transcribimos un audio de prueba de 0,1 s con tu key."
        : `No funcionó: ${r.error ?? "error desconocido"}`;
    });
  const remove = () =>
    run("remove", async () => {
      await transcriptionApi.remove();
      return "Conexión de transcripción quitada.";
    });

  return (
    <Card className="flex flex-col gap-4 sm:p-6" data-testid="transcription-card">
      <h2 className="m-0 flex items-center gap-3 text-[19px]">
        <Mic aria-hidden className="size-5" />
        Transcripción de audios (opcional)
      </h2>
      <p className="m-0 text-sm text-muted">
        Algunos proveedores, como OpenRouter, no transcriben audios: sin esto, la IA no entiende las notas de voz de tus clientes.
        Agrega una API key de OpenAI que usaremos <strong>solo</strong> para transcribir audios; tu proveedor principal sigue igual.
        Créala en{" "}
        <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer noopener" className="underline">
          platform.openai.com/api-keys
        </a>
        .
      </p>
      <p className="m-0 text-sm font-semibold" data-testid="transcription-status" data-source={status?.source ?? "loading"}>
        {status ? SOURCE_TEXT[status.source] : "Cargando…"}
      </p>
      {conn?.lastTestOk === false ? <p className="m-0 text-sm text-muted">La última prueba falló; mientras tanto no se usa esta key.</p> : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ai-transcription-key">API key de OpenAI</Label>
          <Input
            id="ai-transcription-key"
            type="password"
            autoComplete="new-password"
            data-1p-ignore
            data-lpignore="true"
            spellCheck={false}
            placeholder={conn?.apiKeyHint ? `Guardada (${conn.apiKeyHint}). Pega otra para cambiarla` : "sk-…"}
            value={apiKey}
            disabled={!canEdit}
            onChange={(e) => setApiKey(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ai-transcription-model">Modelo de transcripción</Label>
          <Input id="ai-transcription-model" list="ai-transcription-models" autoComplete="off" value={model} disabled={!canEdit} onChange={(e) => setModel(e.target.value)} />
          <datalist id="ai-transcription-models">
            {DEFAULT_TRANSCRIPTION_MODELS.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </div>
      </div>
      {note ? <p className="m-0 text-sm" role="status">{note}</p> : null}
      <Alert>{error}</Alert>
      {canEdit ? (
        <div className="flex flex-wrap gap-2">
          <Button variant="accent" onClick={() => void save()} disabled={busy !== null}>
            {busy === "save" ? <Spinner /> : null}Guardar
          </Button>
          {conn ? (
            <>
              <Button variant="outline" onClick={() => void test()} disabled={busy !== null}>
                {busy === "test" ? <Spinner /> : <Plug aria-hidden className="size-4" />}Probar
              </Button>
              <Button variant="ghost" onClick={() => void remove()} disabled={busy !== null}>
                <Trash2 aria-hidden className="size-4" />Quitar
              </Button>
            </>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
