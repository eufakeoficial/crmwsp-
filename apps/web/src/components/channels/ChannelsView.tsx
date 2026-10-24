"use client";

import type { Channel } from "@crmwsp/contracts";
import { Lock, MailCheck, Plug } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { EmptyState, PageHeader } from "@/components/app/EmptyState";
import { useSession } from "@/components/app/SessionProvider";
import { Alert, Banner, Button, Modal, Toast } from "@/components/ui";
import { canManageChannels } from "@/components/app/roles";
import { useToast } from "@/lib/hooks/use-toast";
import { buildDialog360ConnectUrl, DIALOG360_STATE_KEY } from "@/lib/dialog360";
import { channelsApi } from "@/lib/inbox-api";
import { api } from "@/lib/api";
import { EMAIL_NOT_VERIFIED_TEXT, channelErrorMessage, errorMessage, isEmailNotVerified, isEncryptionNotConfigured } from "@/lib/messages";
import { ChannelCard } from "./ChannelCard";
import { ConnectChannelDialog } from "./ConnectChannelDialog";
import { PartnerCredentialsDialog } from "./PartnerCredentialsDialog";

export function ChannelsView() {
  const { me, tenant } = useSession();
  const canManage = canManageChannels(tenant?.role);
  const [channels, setChannels] = useState<Channel[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [connecting, setConnecting] = useState(false);
  const [confirmRotate, setConfirmRotate] = useState<Channel | null>(null);
  const [partnerFor, setPartnerFor] = useState<Channel | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [d360PartnerId, setD360PartnerId] = useState<string | null>(null);
  const { message, show } = useToast();
  const [resending, setResending] = useState(false);

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

  // The server issues a single-use state bound to this user; the callback must send it back.
  async function startDialog360(partnerId: string) {
    try {
      const { state } = await channelsApi.dialog360ConnectState();
      try {
        window.sessionStorage.setItem(DIALOG360_STATE_KEY, state);
      } catch {
        // Storage blocked: the state still travels in the redirect URL.
      }
      window.location.assign(buildDialog360ConnectUrl(partnerId, window.location.origin, state));
    } catch (err) {
      setError(err);
    }
  }

  async function resendVerification() {
    setResending(true);
    try {
      await api.resendVerification();
      show(`Te enviamos un correo a ${me.user.email}.`);
    } catch (err) {
      show(errorMessage(err));
    } finally {
      setResending(false);
    }
  }

  const noKeys = isEncryptionNotConfigured(error);
  const isOwner = tenant?.role === "owner";
  // Connecting WhatsApp waits for the owner's verified email (API: 403 EMAIL_NOT_VERIFIED).
  const emailBlocked = (isOwner && me.user.emailVerified === false) || isEmailNotVerified(error);
  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader title="Canales" subtitle="Conecta y administra los números de WhatsApp con los que atiendes a tus clientes." />
        {canManage ? (
          <div className="flex flex-wrap gap-2">
            {d360PartnerId ? (
              <Button variant="whatsapp" disabled={emailBlocked} onClick={() => void startDialog360(d360PartnerId)}>
                <Plug aria-hidden className="size-5" />Conectar con 360dialog (mantén tu WhatsApp Business)
              </Button>
            ) : null}
            <Button variant={d360PartnerId ? "outline" : "whatsapp"} disabled={emailBlocked} onClick={() => setConnecting(true)}>
              <Plug aria-hidden className="size-5" />Conectar WhatsApp (Gupshup)
            </Button>
          </div>
        ) : null}
      </div>
      {emailBlocked ? (
        <div className="mb-4">
          <Banner tone="info" icon={MailCheck}>
            <b>{EMAIL_NOT_VERIFIED_TEXT}.</b>{" "}
            {isOwner
              ? "Te enviamos un enlace al registrarte. Mientras tanto puedes configurar todo lo demás."
              : "Quien creó la cuenta debe confirmar su correo."}
            {isOwner ? (
              <span className="mt-2 block">
                <Button variant="outline" size="sm" disabled={resending} onClick={() => void resendVerification()}>
                  {resending ? "Enviando…" : "Reenviar correo"}
                </Button>
              </span>
            ) : null}
          </Banner>
        </div>
      ) : null}
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
