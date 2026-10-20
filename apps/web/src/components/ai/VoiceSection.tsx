"use client";

import { type FormEvent, useEffect, useState } from "react";
import { Alert, Button, Card, Input, Label, OptionCard, Spinner, Toast } from "@/components/ui";
import { VOICE_REPLY_MODES, type VoiceReplyMode, type VoiceSettingsDto } from "@crmwsp/contracts";
import { voiceApi } from "@/lib/voice-api";
import { useToast } from "@/lib/hooks/use-toast";
import { errorMessage } from "@/lib/messages";

const MODE_LABELS: Record<VoiceReplyMode, { title: string; hint: string }> = {
  off: { title: "Apagado", hint: "La IA responde siempre por texto." },
  mirror: { title: "Espejo", hint: "Responde con audio solo si el cliente envió audio." },
  always: { title: "Siempre", hint: "Todas las respuestas de la IA van como nota de voz." },
};

/** "Respuestas por voz": BYOK ElevenLabs key (write-only, masked), voice, model, mode and a test. */
export function VoiceSection({ canEdit }: { canEdit: boolean }) {
  const [settings, setSettings] = useState<VoiceSettingsDto>();
  const [apiKey, setApiKey] = useState("");
  const [voiceId, setVoiceId] = useState("");
  const [modelId, setModelId] = useState("eleven_multilingual_v2");
  const [mode, setMode] = useState<VoiceReplyMode>("off");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string>();
  const { message, show } = useToast();

  useEffect(() => {
    voiceApi
      .get()
      .then((s) => {
        setSettings(s);
        setVoiceId(s.voiceId ?? "");
        setModelId(s.modelId);
        setMode(s.replyMode);
      })
      .catch((err: unknown) => setError(errorMessage(err)));
  }, []);

  useEffect(() => () => (audioUrl ? URL.revokeObjectURL(audioUrl) : undefined), [audioUrl]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const saved = await voiceApi.save({ voiceId: voiceId.trim(), modelId: modelId.trim(), replyMode: mode, ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}) });
      setSettings(saved);
      setApiKey("");
      show("Voz guardada");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function onTest() {
    setTesting(true);
    setError(undefined);
    try {
      const res = await voiceApi.test();
      if (!res.ok || !res.audioBase64) return setError(res.error ?? "No se pudo generar el audio.");
      const bytes = Uint8Array.from(atob(res.audioBase64), (c) => c.charCodeAt(0));
      setAudioUrl(URL.createObjectURL(new Blob([bytes], { type: res.mimeType ?? "audio/mpeg" })));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setTesting(false);
    }
  }

  if (!settings && !error) return <p className="text-muted" aria-busy="true">Cargando voz…</p>;
  return (
    <Card id="voz" className="scroll-mt-24 sm:p-6">
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <h2 className="m-0 text-[19px]">Respuestas por voz</h2>
        <p className="m-0 text-sm text-ink-3">
          Usa tu propia clave de ElevenLabs. La IA envía como nota de voz el mismo texto ya aprobado; si la voz falla, se envía el texto.
        </p>
        {error ? <Alert>{error}</Alert> : null}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="voice-key">Clave API de ElevenLabs</Label>
          <Input
            id="voice-key"
            type="password"
            autoComplete="off"
            value={apiKey}
            disabled={!canEdit}
            placeholder={settings?.hasApiKey ? `Guardada (${settings.apiKeyHint ?? "••••"}). Escribe para reemplazarla.` : "xi-…"}
            onChange={(e) => setApiKey(e.target.value)}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="voice-id">ID de voz</Label>
            <Input id="voice-id" value={voiceId} disabled={!canEdit} onChange={(e) => setVoiceId(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="voice-model">Modelo</Label>
            <Input id="voice-model" value={modelId} disabled={!canEdit} onChange={(e) => setModelId(e.target.value)} />
          </div>
        </div>
        <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
          <legend className="mb-2 text-sm font-bold">Cuándo responder con voz</legend>
          <div role="radiogroup" className="grid gap-3 sm:grid-cols-3">
            {VOICE_REPLY_MODES.map((m) => (
              <OptionCard key={m} mode="radio" selected={mode === m} onSelect={() => canEdit && setMode(m)} className={canEdit ? "" : "cursor-not-allowed opacity-70"}>
                <b className="block">{MODE_LABELS[m].title}</b>
                <span className="text-sm text-ink-3">{MODE_LABELS[m].hint}</span>
              </OptionCard>
            ))}
          </div>
        </fieldset>
        {audioUrl ? <audio controls src={audioUrl} className="w-full" /> : null}
        {canEdit ? (
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="accent" disabled={busy}>
              {busy ? <Spinner /> : null} Guardar voz
            </Button>
            <Button type="button" variant="outline" disabled={testing || !settings?.hasApiKey || !settings.voiceId} onClick={() => void onTest()}>
              {testing ? <Spinner /> : null} Probar voz
            </Button>
          </div>
        ) : null}
      </form>
      <Toast message={message} />
    </Card>
  );
}
