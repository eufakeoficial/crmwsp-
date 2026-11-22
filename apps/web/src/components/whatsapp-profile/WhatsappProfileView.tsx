"use client";

import type { Channel } from "@crmwsp/contracts";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { EmptyState, PageHeader } from "@/components/app/EmptyState";
import { canManageChannels } from "@/components/app/roles";
import { useSession } from "@/components/app/SessionProvider";
import { AiAssistButton, Alert, CHIP_ROW, Card, Chip, Toast, buttonClasses } from "@/components/ui";
import { buildProfilePrompt } from "@/lib/ai-assist-prompts";
import { cn } from "@/lib/cn";
import { useToast } from "@/lib/hooks/use-toast";
import { channelsApi } from "@/lib/inbox-api";
import { channelErrorMessage } from "@/lib/messages";
import { DisplayNameCard } from "./DisplayNameCard";
import { MissingCredentialsCard } from "./MissingCredentialsCard";
import { ProfileEditor } from "./ProfileEditor";

export function WhatsappProfileView() {
  const { tenant } = useSession();
  const canManage = canManageChannels(tenant?.role);
  const [channels, setChannels] = useState<Channel[] | null>(null);
  const [channelId, setChannelId] = useState<string | null>(null);
  const [error, setError] = useState<string>();
  const { message, show } = useToast();

  useEffect(() => {
    channelsApi.list().then(
      (r) => {
        const gupshup = r.items.filter((c) => c.provider === "gupshup");
        setChannels(gupshup);
        setChannelId((cur) => cur ?? gupshup[0]?.id ?? null);
      },
      (err) => setError(channelErrorMessage(err)),
    );
  }, []);

  const channel = useMemo(() => channels?.find((c) => c.id === channelId) ?? null, [channels, channelId]);

  return (
    <>
      <PageHeader title="Perfil de WhatsApp" subtitle="Foto, descripción y datos de contacto que ven tus clientes en tu WhatsApp Business." />

      {channels && channels.length > 1 ? (
        <div className={cn(CHIP_ROW, "mb-4")} role="group" aria-label="Canal">
          {channels.map((c) => (
            <Chip key={c.id} active={c.id === channelId} onClick={() => setChannelId(c.id)}>
              {c.phoneE164}
            </Chip>
          ))}
        </div>
      ) : null}

      <div className="mb-4"><Alert>{error}</Alert></div>

      {!canManage ? (
        <EmptyState title="Sin acceso">Pide a un propietario o administrador que edite el perfil de WhatsApp.</EmptyState>
      ) : channels === null && !error ? (
        <p className="text-muted" aria-busy="true">Cargando…</p>
      ) : channels && channels.length === 0 ? (
        <EmptyState title="Aún no hay un número de Gupshup conectado">
          Conecta tu número de WhatsApp para editar su perfil.{" "}
          <Link href="/app/channels" className={buttonClasses("accent", "mt-3", "sm")}>Ir a Canales</Link>
        </EmptyState>
      ) : channel && !channel.partnerConfigured ? (
        <MissingCredentialsCard phone={channel.phoneE164} appName={channel.appName} />
      ) : channel ? (
        <div className="flex flex-col gap-4">
          <ProfileEditor key={channel.id} channelId={channel.id} onSaved={show} />
          <DisplayNameCard key={`dn-${channel.id}`} channelId={channel.id} phone={channel.phoneE164} onSent={show} />
          <Card className="flex flex-col items-start gap-2">
            <p className="m-0 text-sm text-muted">¿Algo del perfil no se puede cambiar desde aquí? Pide a tu asistente de IA que lo complete por ti en Meta.</p>
            <AiAssistButton prompt={buildProfilePrompt({ phone: channel.phoneE164, appName: channel.appName })} label="Hacerlo con IA: completar el perfil" />
          </Card>
        </div>
      ) : null}
      <Toast message={message} />
    </>
  );
}
