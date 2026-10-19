"use client";

import type { Channel } from "@crmwsp/contracts";
import { createGupshupChannelRequestSchema } from "@crmwsp/contracts";
import { type FormEvent, useState } from "react";
import { Alert, Button, Input, Label, Modal, Spinner } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { channelsApi } from "@/lib/inbox-api";
import { channelErrorMessage, isEncryptionNotConfigured } from "@/lib/messages";
import { WebhookUrlBox } from "./WebhookUrlBox";

const STEPS = [
  "Crea una app de WhatsApp en la consola de Gupshup.",
  "Copia la API key de esa app y pégala en el formulario de abajo.",
  "Pega la URL de webhook en Gupshup (Callback URL): te la mostramos al conectar el canal.",
] as const;

/** Guide + form to connect a Gupshup number. After creation it shows the webhook URL once more. */
export function ConnectChannelDialog({ onClose, onCreated, onNoKeys }: { onClose: () => void; onCreated: (c: Channel) => void; onNoKeys: (err: ApiError) => void }) {
  const [phone, setPhone] = useState("");
  const [appName, setAppName] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [created, setCreated] = useState<Channel | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = createGupshupChannelRequestSchema.safeParse({ phoneE164: phone.trim(), appName, apiKey });
    if (!parsed.success) {
      setError("Revisa los datos: el teléfono va en formato internacional (+5491155551234) y la API key debe tener al menos 8 caracteres.");
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const channel = await channelsApi.createGupshup(parsed.data);
      setApiKey("");
      setCreated(channel);
      onCreated(channel);
    } catch (err) {
      if (isEncryptionNotConfigured(err)) {
        onNoKeys(err);
        return;
      }
      setError(err instanceof ApiError && err.status === 409 ? "Ya existe un canal con ese teléfono." : channelErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (created) {
    return (
      <Modal title="Canal conectado" onClose={onClose} footer={<Button variant="accent" onClick={onClose}>Listo</Button>}>
        <p className="m-0">El número <b>{created.phoneE164}</b> ya está activo. Falta un último paso en Gupshup:</p>
        {created.webhookUrl ? <WebhookUrlBox url={created.webhookUrl} /> : null}
        <p className="m-0 text-sm text-muted">Pégala en <b>Gupshup → Callback URL</b>. Después podrás recibir mensajes en el Inbox.</p>
        <p className="m-0 rounded-2xl bg-warning-soft px-4 py-3 text-sm font-semibold text-warning">
          La API key no se vuelve a mostrar. Solo verás sus últimos caracteres ({created.apiKeyHint ?? "••••"}).
        </p>
      </Modal>
    );
  }

  return (
    <Modal title="Conectar WhatsApp (Gupshup)" onClose={onClose} wide>
      <ol className="m-0 flex list-none flex-col gap-2 p-0">
        {STEPS.map((text, i) => (
          <li key={text} className="flex items-start gap-3 text-sm">
            <span aria-hidden className="grid size-7 flex-none place-items-center rounded-full bg-lime text-[13px] font-extrabold text-ink">{i + 1}</span>
            <span className="pt-0.5">{text}</span>
          </li>
        ))}
      </ol>
      <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ch-phone">Teléfono (formato internacional)</Label>
          <Input id="ch-phone" data-autofocus inputMode="tel" autoComplete="off" placeholder="+5491155551234" value={phone} onChange={(e) => setPhone(e.target.value)} required />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ch-app">Nombre de la app en Gupshup</Label>
          <Input id="ch-app" autoComplete="off" placeholder="MiEmpresaApp" value={appName} onChange={(e) => setAppName(e.target.value)} required />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ch-key">API key de Gupshup</Label>
          <Input id="ch-key" type="password" autoComplete="off" value={apiKey} onChange={(e) => setApiKey(e.target.value)} required />
          <span className="text-xs text-muted">Se guarda cifrada y no se vuelve a mostrar.</span>
        </div>
        <Alert>{error}</Alert>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button type="submit" variant="accent" disabled={busy}>
            {busy ? <Spinner /> : null}Conectar canal
          </Button>
        </div>
      </form>
    </Modal>
  );
}
