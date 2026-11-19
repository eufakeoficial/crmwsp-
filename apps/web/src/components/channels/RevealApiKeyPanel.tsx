"use client";

import { revealChannelApiKeyResponseSchema } from "@crmwsp/contracts";
import { Copy, Eye, X } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Alert, Button, Input, Toast } from "@/components/ui";
import { request } from "@/lib/api";
import { useToast } from "@/lib/hooks/use-toast";
import { countdownLabel, revealErrorMessage, secondsLeft } from "@/lib/reveal-api-key";

interface Revealed {
  apiKey: string;
  expiresAt: number;
}

/**
 * ADR 0022: owner-only "Mostrar API key". Re-asks the password every time, shows the key for the
 * seconds the API allows, then drops it from state. The key and the password live only in React
 * state (never storage or the URL) and are cleared on hide, close and unmount.
 */
export function RevealApiKeyPanel({ channelId }: { channelId: string }) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<Revealed | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const { message, show } = useToast();

  useEffect(() => {
    if (!revealed) return;
    const tick = () => {
      const t = Date.now();
      if (secondsLeft(revealed.expiresAt, t) <= 0) setRevealed(null);
      else setNow(t);
    };
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [revealed]);

  function close() {
    setOpen(false);
    setPassword("");
    setError(null);
    setRevealed(null);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!password || busy) return;
    const pw = password;
    setPassword("");
    setBusy(true);
    setError(null);
    try {
      const res = await request(`/channels/${channelId}/reveal-api-key`, { method: "POST", body: { password: pw }, schema: revealChannelApiKeyResponseSchema });
      const t = Date.now();
      setNow(t);
      setRevealed({ apiKey: res.apiKey, expiresAt: t + res.expiresInSeconds * 1000 });
    } catch (err) {
      setError(revealErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!revealed) return;
    try {
      await navigator.clipboard.writeText(revealed.apiKey);
      show("API key copiada");
    } catch {
      show("No se pudo copiar: selecciónala y cópiala a mano");
    }
  }

  if (!open) {
    return (
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Eye aria-hidden className="size-4" />Mostrar API key
      </Button>
    );
  }

  const left = revealed ? secondsLeft(revealed.expiresAt, now) : 0;
  return (
    <div className="flex w-full flex-col gap-2 rounded-2xl bg-paper p-3" data-testid="reveal-api-key-panel">
      {revealed ? (
        <>
          <label className="text-xs font-extrabold text-muted" htmlFor={`revealed-key-${channelId}`}>API key</label>
          <Input
            id={`revealed-key-${channelId}`}
            data-testid="revealed-api-key"
            readOnly
            value={revealed.apiKey}
            className="font-mono text-[13px]"
            autoComplete="off"
            spellCheck={false}
            onFocus={(e) => e.currentTarget.select()}
          />
          <p className="m-0 text-xs text-muted" aria-live="polite" data-testid="reveal-countdown">{countdownLabel(left)}</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={copy}>
              <Copy aria-hidden className="size-4" />Copiar
            </Button>
            <Button size="sm" variant="outline" onClick={close}>
              <X aria-hidden className="size-4" />Ocultar
            </Button>
          </div>
        </>
      ) : (
        <form className="flex flex-col gap-2" onSubmit={submit}>
          <label className="text-sm font-extrabold" htmlFor={`reveal-password-${channelId}`}>Confirma tu contraseña</label>
          <Input
            id={`reveal-password-${channelId}`}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="off"
            data-1p-ignore
            data-lpignore="true"
            disabled={busy}
          />
          {error ? <Alert>{error}</Alert> : null}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" type="submit" disabled={busy || !password}>Mostrar</Button>
            <Button size="sm" variant="outline" type="button" onClick={close}>Cancelar</Button>
          </div>
        </form>
      )}
      <Toast message={message} />
    </div>
  );
}
