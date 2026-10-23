"use client";

import type { Channel } from "@crmwsp/contracts";
import { setPartnerCredentialsRequestSchema } from "@crmwsp/contracts";
import { type FormEvent, useState } from "react";
import { Alert, Button, Input, Label, Modal, Spinner } from "@/components/ui";
import type { ApiError } from "@/lib/api";
import { channelsApi } from "@/lib/inbox-api";
import { channelErrorMessage, isEncryptionNotConfigured } from "@/lib/messages";

/** Sets the Gupshup Partner app id + token (needed for templates). The token is write-only and never shown back. */
export function PartnerCredentialsDialog({ channel, onClose, onSaved, onNoKeys }: { channel: Channel; onClose: () => void; onSaved: (c: Channel) => void; onNoKeys: (err: ApiError) => void }) {
  const [appId, setAppId] = useState(channel.gupshupAppId ?? "");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = setPartnerCredentialsRequestSchema.safeParse({ gupshupAppId: appId, partnerToken: token });
    if (!parsed.success) {
      setError("Revisa los datos: completa el ID de app y el token de Partner (mínimo 8 caracteres).");
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const updated = await channelsApi.setPartnerCredentials(channel.id, parsed.data);
      setToken("");
      onSaved(updated);
    } catch (err) {
      if (isEncryptionNotConfigured(err)) {
        onNoKeys(err as ApiError);
        return;
      }
      setError(channelErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Credenciales de plantillas (Gupshup)" onClose={onClose}>
      <p className="m-0 text-sm text-muted">Necesarias para crear y sincronizar plantillas de WhatsApp del número <b>{channel.phoneE164}</b>.</p>
      <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="pc-app">ID de app de Gupshup</Label>
          <Input id="pc-app" data-autofocus autoComplete="off" value={appId} onChange={(e) => setAppId(e.target.value)} required />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="pc-token">Token de Partner</Label>
          <Input id="pc-token" type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} required />
          <span className="text-xs text-muted">Se guarda cifrado y no se vuelve a mostrar.</span>
        </div>
        <Alert>{error}</Alert>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button type="submit" variant="accent" disabled={busy}>
            {busy ? <Spinner /> : null}Guardar
          </Button>
        </div>
      </form>
    </Modal>
  );
}
