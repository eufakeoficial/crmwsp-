"use client";

import type { Channel } from "@crmwsp/contracts";
import { updateGupshupCredentialsRequestSchema } from "@crmwsp/contracts";
import { type FormEvent, useState } from "react";
import { Alert, Button, Input, Label, Spinner } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { channelsApi } from "@/lib/inbox-api";
import { channelErrorMessage, isEncryptionNotConfigured } from "@/lib/messages";

/**
 * Replaces the Gupshup API key and app name of a channel without touching its webhook URL.
 * The key is write-only: it is never prefilled and is cleared after saving.
 */
export function EditCredentialsPanel({ channel, onClose, onSaved, onNoKeys }: { channel: Channel; onClose: () => void; onSaved: (c: Channel) => void; onNoKeys: (err: ApiError) => void }) {
  const [appName, setAppName] = useState(channel.appName ?? "");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = updateGupshupCredentialsRequestSchema.safeParse({ appName, apiKey });
    if (!parsed.success) {
      setError("Revisa los datos: completa el nombre de la app y la API key (mínimo 8 caracteres).");
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const updated = await channelsApi.updateCredentials(channel.id, parsed.data);
      setApiKey("");
      onSaved(updated);
    } catch (err) {
      if (isEncryptionNotConfigured(err)) {
        onNoKeys(err as ApiError);
        return;
      }
      setError(err instanceof ApiError && err.status === 409 ? "Esa app de Gupshup ya está conectada a otro canal." : channelErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-line bg-paper p-4" data-testid="edit-credentials-panel">
      <b>Editar credenciales de Gupshup</b>
      <p className="m-0 text-sm text-muted">
        Cambia la API key o el nombre de la app del número <b>{channel.phoneE164}</b>. Verificamos los datos con Gupshup antes de guardar y la URL del webhook no cambia.
      </p>
      <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ec-app">Nombre de la app en Gupshup</Label>
          <Input id="ec-app" autoComplete="off" data-1p-ignore data-lpignore="true" value={appName} onChange={(e) => setAppName(e.target.value)} required />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ec-key">API key nueva</Label>
          <Input id="ec-key" type="password" autoComplete="new-password" data-1p-ignore data-lpignore="true" value={apiKey} onChange={(e) => setApiKey(e.target.value)} required />
          <span className="text-xs text-muted">Se guarda cifrada y no se vuelve a mostrar.</span>
        </div>
        <Alert>{error}</Alert>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button type="submit" variant="accent" disabled={busy}>
            {busy ? <Spinner /> : null}Guardar
          </Button>
        </div>
      </form>
    </div>
  );
}
