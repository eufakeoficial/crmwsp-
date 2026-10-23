"use client";

import type { Channel } from "@crmwsp/contracts";
import { Lock, Plug } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { EmptyState, PageHeader } from "@/components/app/EmptyState";
import { useSession } from "@/components/app/SessionProvider";
import { Alert, Banner, Button, Modal, Toast } from "@/components/ui";
import { canManageChannels } from "@/components/app/roles";
import { useToast } from "@/lib/hooks/use-toast";
import { channelsApi } from "@/lib/inbox-api";
import { channelErrorMessage, isEncryptionNotConfigured } from "@/lib/messages";
import { ChannelCard } from "./ChannelCard";
import { ConnectChannelDialog } from "./ConnectChannelDialog";
import { PartnerCredentialsDialog } from "./PartnerCredentialsDialog";

export function ChannelsView() {
  const { tenant } = useSession();
  const canManage = canManageChannels(tenant?.role);
  const [channels, setChannels] = useState<Channel[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [connecting, setConnecting] = useState(false);
  const [confirmRotate, setConfirmRotate] = useState<Channel | null>(null);
  const [partnerFor, setPartnerFor] = useState<Channel | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
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

  const noKeys = isEncryptionNotConfigured(error);
  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader title="Canales" subtitle="Conecta y administra los números de WhatsApp con los que atiendes a tus clientes." />
        {canManage ? (
          <Button variant="whatsapp" onClick={() => setConnecting(true)}>
            <Plug aria-hidden className="size-5" />Conectar WhatsApp (Gupshup)
          </Button>
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
      {channels === null && !error ? (
        <p className="text-muted" aria-busy="true">Cargando canales…</p>
      ) : channels && channels.length === 0 ? (
        <EmptyState title="Aún no hay canales">
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
            />
          ))}
        </div>
      )}
      {connecting ? (
        <ConnectChannelDialog
          onClose={() => setConnecting(false)}
          onNoKeys={(err) => {
            setConnecting(false);
            setError(err);
          }}
          onCreated={(c) => {
            setChannels((list) => [...(list ?? []), c]);
            setError(null);
          }}
        />
      ) : null}
      {partnerFor ? (
        <PartnerCredentialsDialog
          channel={partnerFor}
          onClose={() => setPartnerFor(null)}
          onNoKeys={(err) => {
            setPartnerFor(null);
            setError(err);
          }}
          onSaved={(c) => {
            replace(c);
            setPartnerFor(null);
            setError(null);
            show("Credenciales de plantillas guardadas");
          }}
        />
      ) : null}
      {confirmRotate ? (
        <Modal
          title="¿Rotar el token del webhook?"
          onClose={() => setConfirmRotate(null)}
          footer={
            <>
              <Button variant="outline" onClick={() => setConfirmRotate(null)}>Cancelar</Button>
              <Button
                variant="primary"
                onClick={() => {
                  const c = confirmRotate;
                  setConfirmRotate(null);
                  void act(c.id, () => channelsApi.rotateWebhookToken(c.id), "Token rotado: pega la nueva URL en Gupshup");
                }}
              >
                Rotar token
              </Button>
            </>
          }
        >
          <p className="m-0">La URL actual <b>dejará de funcionar</b> de inmediato. Tendrás que pegar la nueva URL en Gupshup → Callback URL, o no llegarán mensajes nuevos al Inbox.</p>
        </Modal>
      ) : null}
      <Toast message={message} />
    </>
  );
}
