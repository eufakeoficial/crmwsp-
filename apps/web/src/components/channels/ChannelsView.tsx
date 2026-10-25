"use client";

import type { Channel } from "@crmwsp/contracts";
import { Lock, Plug } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { EmptyState, PageHeader } from "@/components/app/EmptyState";
import { useSession } from "@/components/app/SessionProvider";
import { Alert, Banner, Button, Toast } from "@/components/ui";
import { canManageChannels } from "@/components/app/roles";
import { useToast } from "@/lib/hooks/use-toast";
import { buildDialog360ConnectUrl } from "@/lib/dialog360";
import { channelsApi } from "@/lib/inbox-api";
import { channelErrorMessage, isEncryptionNotConfigured } from "@/lib/messages";
import { ChannelCard } from "./ChannelCard";
import { ConnectChannelPanel } from "./ConnectChannelPanel";
import { PartnerCredentialsPanel } from "./PartnerCredentialsPanel";

export function ChannelsView() {
  const { tenant } = useSession();
  const canManage = canManageChannels(tenant?.role);
  const [channels, setChannels] = useState<Channel[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  // null = follow the default (panel open only while there are no channels).
  const [connecting, setConnecting] = useState<boolean | null>(null);
  const [confirmRotate, setConfirmRotate] = useState<Channel | null>(null);
  const [partnerFor, setPartnerFor] = useState<Channel | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [d360PartnerId, setD360PartnerId] = useState<string | null>(null);
  const { message, show } = useToast();

  const load = useCallback(async () => {
    try {
      setChannels((await channelsApi.list()).items);
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  // Hidden unless the server has 360dialog partner credentials configured.
  useEffect(() => {
    if (!canManage) return;
    channelsApi.dialog360Config().then((c) => setD360PartnerId(c.partnerId), () => setD360PartnerId(null));
  }, [canManage]);

  const replace = (c: Channel) => setChannels((list) => (list ?? []).map((x) => (x.id === c.id ? c : x)));

  async function act(id: string, fn: () => Promise<Channel>, ok: string) {
    setBusyId(id);
    try {
      replace(await fn());
      show(ok);
    } catch (err) {
      setError(err);
    } finally {
      setBusyId(null);
    }
  }

  const panelOpen = canManage && (connecting ?? channels?.length === 0);
  const noKeys = isEncryptionNotConfigured(error);
  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader title="Canales" subtitle="Conecta y administra los números de WhatsApp con los que atiendes a tus clientes." />
        {canManage ? (
          <div className="flex flex-wrap gap-2">
            {d360PartnerId ? (
              <Button variant="whatsapp" onClick={() => window.location.assign(buildDialog360ConnectUrl(d360PartnerId, window.location.origin))}>
                <Plug aria-hidden className="size-5" />Conectar con 360dialog (mantén tu WhatsApp Business)
              </Button>
            ) : null}
            <Button variant={d360PartnerId ? "outline" : "whatsapp"} aria-expanded={panelOpen} onClick={() => setConnecting(!panelOpen)}>
              <Plug aria-hidden className="size-5" />{panelOpen ? "Cerrar guía de conexión" : channels && channels.length > 0 ? "Conectar otro número" : "Conectar WhatsApp (Gupshup)"}
            </Button>
          </div>
        ) : null}
      </div>
      {noKeys ? (
        <div className="mb-4">
          <Banner tone="info" icon={Lock}>
            <b>El servidor no tiene configuradas las claves de cifrado.</b> No se pueden crear canales hasta que quien administre el servidor defina ENCRYPTION_MASTER_KEY.
          </Banner>
        </div>
      ) : error ? (
        <div className="mb-4"><Alert>{channelErrorMessage(error)}</Alert></div>
      ) : null}
      {panelOpen ? (
        <div className="mb-4">
          <ConnectChannelPanel
            onClose={() => setConnecting(false)}
            onNoKeys={(err) => {
              setConnecting(false);
              setError(err);
            }}
            onCreated={(c) => {
              setChannels((list) => [...(list ?? []), c]);
              setConnecting(true); // keep the panel mounted to show the webhook URL
              setError(null);
            }}
          />
        </div>
      ) : null}
      {channels === null && !error ? (
        <p className="text-muted" aria-busy="true">Cargando canales…</p>
      ) : channels && channels.length === 0 ? (
        panelOpen ? null : <EmptyState title="Aún no hay canales">
          {canManage ? "Primer paso: conecta tu número de WhatsApp con el botón de arriba para empezar a recibir mensajes." : "Pide a un administrador que conecte un número de WhatsApp."}
        </EmptyState>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {channels?.map((c) => (
            <ChannelCard
              key={c.id}
              channel={c}
              canManage={canManage}
              busy={busyId === c.id}
              onRotate={() => setConfirmRotate(c)}
              onPartner={() => setPartnerFor(c)}
              onToggle={() => void act(c.id, () => channelsApi.setStatus(c.id, c.status === "disabled" ? "active" : "disabled"), c.status === "disabled" ? "Canal activado" : "Canal desactivado")}
            >
              {confirmRotate?.id === c.id ? (
                <div role="alertdialog" aria-label="Confirmar rotación del token" className="flex flex-col gap-3 rounded-2xl bg-warning-soft p-4">
                  <p className="m-0 text-sm"><b>¿Rotar el token del webhook?</b> La URL actual <b>dejará de funcionar</b> de inmediato. Tendrás que pegar la nueva URL en Gupshup → Callback URL, o no llegarán mensajes nuevos al Inbox.</p>
                  <div className="flex justify-end gap-2">
                    <Button size="sm" variant="outline" onClick={() => setConfirmRotate(null)}>Cancelar</Button>
                    <Button
                      size="sm"
                      variant="primary"
                      onClick={() => {
                        setConfirmRotate(null);
                        void act(c.id, () => channelsApi.rotateWebhookToken(c.id), "Token rotado: pega la nueva URL en Gupshup");
                      }}
                    >
                      Confirmar
                    </Button>
                  </div>
                </div>
              ) : null}
              {partnerFor?.id === c.id ? (
                <PartnerCredentialsPanel
                  channel={c}
                  onClose={() => setPartnerFor(null)}
                  onNoKeys={(err) => {
                    setPartnerFor(null);
                    setError(err);
                  }}
                  onSaved={(updated) => {
                    replace(updated);
                    setPartnerFor(null);
                    setError(null);
                    show("Credenciales de plantillas guardadas");
                  }}
                />
              ) : null}
            </ChannelCard>
          ))}
        </div>
      )}
      <Toast message={message} />
    </>
  );
}
