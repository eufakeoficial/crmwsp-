"use client";

import type { Channel } from "@crmwsp/contracts";
import type { ReactNode } from "react";
import { FileText, KeyRound, Power, RefreshCw } from "lucide-react";
import { Button, Card, StatusChip, type Tone } from "@/components/ui";
import { WebhookUrlBox } from "./WebhookUrlBox";

const QUALITY: Record<NonNullable<Channel["qualityRating"]>, { label: string; tone: Tone }> = {
  GREEN: { label: "alta", tone: "success" },
  YELLOW: { label: "media", tone: "warning" },
  RED: { label: "baja", tone: "danger" },
  UNKNOWN: { label: "desconocida", tone: "paper" },
};
const ACCOUNT: Record<NonNullable<Channel["accountStatus"]>, { label: string; tone: Tone } | null> = {
  ok: null,
  flagged: { label: "Marcado por Meta", tone: "warning" },
  restricted: { label: "Restringido por Meta", tone: "danger" },
  disabled: { label: "Deshabilitado por Meta", tone: "danger" },
};

const STATUS: Record<Channel["status"], { label: string; tone: Tone }> = {
  active: { label: "Activo", tone: "success" },
  pending: { label: "Pendiente", tone: "warning" },
  disabled: { label: "Desactivado", tone: "paper" },
};

export function ChannelCard({
  channel,
  canManage,
  busy,
  onRotate,
  onToggle,
  onPartner,
  children,
}: {
  channel: Channel;
  canManage: boolean;
  busy: boolean;
  onRotate: () => void;
  onToggle: () => void;
  onPartner: () => void;
  /** Inline area below the actions (rotate confirmation, partner credentials form). */
  children?: ReactNode;
}) {
  const st = STATUS[channel.status];
  const disabled = channel.status === "disabled";
  return (
    <Card className="flex flex-col gap-3 p-5 sm:p-5" data-testid="channel-card">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="m-0 text-[19px] font-extrabold break-all">{channel.phoneE164}</p>
          <p className="m-0 text-sm text-muted">
            {channel.appName ?? "Sin nombre"} · {channel.provider === "gupshup" ? "Gupshup" : "360dialog"}
          </p>
        </div>
        <StatusChip label={st.label} tone={st.tone} />
      </div>
      {channel.qualityRating || (channel.accountStatus && ACCOUNT[channel.accountStatus]) ? (
        <p className="m-0 flex flex-wrap items-center gap-2 text-sm" data-testid="quality-status">
          {channel.qualityRating ? (
            <>
              Calidad: <StatusChip label={QUALITY[channel.qualityRating].label} tone={QUALITY[channel.qualityRating].tone} />
            </>
          ) : null}
          {channel.accountStatus && ACCOUNT[channel.accountStatus] ? (
            <StatusChip label={ACCOUNT[channel.accountStatus]!.label} tone={ACCOUNT[channel.accountStatus]!.tone} />
          ) : null}
          {channel.messagingLimit ? <span className="text-muted">Límite: {channel.messagingLimit}</span> : null}
        </p>
      ) : null}
      {canManage && channel.apiKeyHint ? (
        <p className="m-0 flex items-center gap-2 text-sm">
          <KeyRound aria-hidden className="size-4 text-muted" />
          API key: <code>{channel.apiKeyHint}</code>
        </p>
      ) : null}
      {channel.provider === "gupshup" ? (
        <p className="m-0 flex items-center gap-2 text-sm" data-testid="templates-status">
          <FileText aria-hidden className="size-4 text-muted" />
          Plantillas:
          <StatusChip label={channel.partnerConfigured ? "configurado" : "sin configurar"} tone={channel.partnerConfigured ? "success" : "warning"} />
        </p>
      ) : null}
      {canManage && channel.webhookUrl && channel.provider === "gupshup" ? (
        <div className="flex flex-col gap-1">
          <span className="text-xs font-extrabold text-muted">URL de webhook (Gupshup → Callback URL)</span>
          <WebhookUrlBox url={channel.webhookUrl} />
        </div>
      ) : null}
      {canManage ? (
        <div className="flex flex-wrap gap-2 border-t border-line pt-3">
          {/* 360dialog registers the webhook itself at connect time; rotating would silently break it. */}
          {channel.provider === "gupshup" ? (
            <Button size="sm" variant="outline" disabled={busy} onClick={onRotate}>
              <RefreshCw aria-hidden className="size-4" />Rotar token
            </Button>
          ) : null}
          {channel.provider === "gupshup" ? (
            <Button size="sm" variant="outline" disabled={busy} onClick={onPartner}>
              <FileText aria-hidden className="size-4" />{channel.partnerConfigured ? "Cambiar credenciales de plantillas" : "Configurar plantillas"}
            </Button>
          ) : null}
          <Button size="sm" variant={disabled ? "accent" : "outline"} disabled={busy} onClick={onToggle}>
            <Power aria-hidden className="size-4" />{disabled ? "Activar" : "Desactivar"}
          </Button>
        </div>
      ) : null}
      {children}
    </Card>
  );
}
