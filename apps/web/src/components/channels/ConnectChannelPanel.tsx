"use client";

import type { Channel } from "@crmwsp/contracts";
import { createGupshupChannelRequestSchema } from "@crmwsp/contracts";
import { ExternalLink } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Alert, Button, Card, Input, Label, Spinner } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { channelsApi } from "@/lib/inbox-api";
import { channelErrorMessage, isEncryptionNotConfigured } from "@/lib/messages";
import { WebhookUrlBox } from "./WebhookUrlBox";

// Gupshup self-service signup page; opened in a new tab so the user keeps this page.
export const GUPSHUP_SIGNUP_URL = "https://www.gupshup.io/auth/signup";

function StepNumber({ n }: { n: number }) {
  return <span aria-hidden className="grid size-7 flex-none place-items-center rounded-full bg-lime text-[13px] font-extrabold text-ink">{n}</span>;
}

/** Inline step-by-step card to connect a Gupshup number. After creation it shows the webhook URL (step 4). */
export function ConnectChannelPanel({ onClose, onCreated, onNoKeys }: { onClose: () => void; onCreated: (c: Channel) => void; onNoKeys: (err: ApiError) => void }) {
  const [phone, setPhone] = useState("");
  const [appName, setAppName] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [partnerAppId, setPartnerAppId] = useState("");
  const [partnerToken, setPartnerToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [created, setCreated] = useState<Channel | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const hasApp = partnerAppId.trim() !== "";
    const hasToken = partnerToken.trim() !== "";
    if (hasApp !== hasToken) {
      setError("Para habilitar plantillas completa el ID de app y el token de Partner, o deja ambos vacíos.");
      return;
    }
    const parsed = createGupshupChannelRequestSchema.safeParse({
      phoneE164: phone.trim(),
      appName,
      apiKey,
      ...(hasApp ? { gupshupAppId: partnerAppId, partnerToken } : {}),
    });
    if (!parsed.success) {
      setError("Revisa los datos: el teléfono va en formato internacional (+5491155551234) y la API key (y el token de Partner, si lo llenas) deben tener al menos 8 caracteres.");
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const channel = await channelsApi.createGupshup(parsed.data);
      setApiKey("");
      setPartnerToken("");
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

  return (
    <Card className="flex flex-col gap-5 p-5 sm:p-6" data-testid="connect-channel-panel">
      <h2 className="m-0 text-xl font-extrabold">Conectar WhatsApp (Gupshup)</h2>
      <ol className="m-0 flex list-none flex-col gap-5 p-0">
        <li className="flex items-start gap-3">
          <StepNumber n={1} />
          <div className="flex min-w-0 flex-1 flex-col gap-2 pt-0.5">
            <b>Crea tu cuenta en Gupshup</b>
            <span className="text-sm text-muted">Se abre en otra pestaña; vuelve aquí cuando termines.</span>
            <a
              href={GUPSHUP_SIGNUP_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 self-start rounded-full bg-ink px-5 py-2.5 text-sm font-extrabold text-white no-underline"
            >
              <ExternalLink aria-hidden className="size-4" />Crear cuenta en Gupshup
            </a>
          </div>
        </li>
        <li className="flex items-start gap-3">
          <StepNumber n={2} />
          <div className="flex min-w-0 flex-1 flex-col gap-1 pt-0.5">
            <b>Crea la app de WhatsApp</b>
            <span className="text-sm text-muted">En la consola de Gupshup crea una app de WhatsApp y copia el nombre de la app y su API key.</span>
          </div>
        </li>
        <li className="flex items-start gap-3">
          <StepNumber n={3} />
          <div className="flex min-w-0 flex-1 flex-col gap-3 pt-0.5">
            <b>Pega tus datos aquí</b>
            {created ? (
              <p className="m-0 text-sm text-muted">Canal <b>{created.phoneE164}</b> conectado.</p>
            ) : (
              <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="ch-phone">Teléfono (formato internacional)</Label>
                  <Input id="ch-phone" inputMode="tel" autoComplete="off" placeholder="+5491155551234" value={phone} onChange={(e) => setPhone(e.target.value)} required />
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
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="ch-partner-app">ID de app de Gupshup (opcional)</Label>
                  <Input id="ch-partner-app" autoComplete="off" value={partnerAppId} onChange={(e) => setPartnerAppId(e.target.value)} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="ch-partner-token">Token de Partner (opcional)</Label>
                  <Input id="ch-partner-token" type="password" autoComplete="off" value={partnerToken} onChange={(e) => setPartnerToken(e.target.value)} />
                  <span className="text-xs text-muted">Necesarios para crear y sincronizar plantillas de WhatsApp. Se guarda cifrado y no se vuelve a mostrar. Puedes agregarlos después.</span>
                </div>
                <Alert>{error}</Alert>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={onClose}>Cancelar</Button>
                  <Button type="submit" variant="accent" disabled={busy}>
                    {busy ? <Spinner /> : null}Conectar canal
                  </Button>
                </div>
              </form>
            )}
          </div>
        </li>
        <li className={`flex items-start gap-3 ${created ? "" : "opacity-60"}`}>
          <StepNumber n={4} />
          <div className="flex min-w-0 flex-1 flex-col gap-2 pt-0.5">
            <b>Pega la URL de webhook en Gupshup</b>
            {created ? (
              <>
                <p className="m-0 text-sm">El número <b>{created.phoneE164}</b> ya está activo. Falta un último paso en Gupshup:</p>
                {created.webhookUrl ? <WebhookUrlBox url={created.webhookUrl} /> : null}
                <p className="m-0 text-sm text-muted">Pégala en <b>Gupshup → Callback URL</b>. Después podrás recibir mensajes en el Inbox.</p>
                <p className="m-0 rounded-2xl bg-warning-soft px-4 py-3 text-sm font-semibold text-warning">
                  La API key no se vuelve a mostrar. Solo verás sus últimos caracteres ({created.apiKeyHint ?? "••••"}).
                </p>
                <Button variant="accent" className="self-start" onClick={onClose}>Listo</Button>
              </>
            ) : (
              <span className="text-sm text-muted">Al conectar el canal te mostramos la URL para pegarla en Gupshup → Callback URL.</span>
            )}
          </div>
        </li>
      </ol>
    </Card>
  );
}
