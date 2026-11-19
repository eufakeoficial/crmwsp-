"use client";

import type { Channel, ChannelHealth } from "@crmwsp/contracts";
import type { ReactNode } from "react";
import { FileText, Inbox, KeyRound, Pencil, Power, RefreshCw, Send } from "lucide-react";
import { AiAssistButton, Button, Card, StatusChip, type Tone } from "@/components/ui";
import { buildApiKeyPrompt, buildRechargePrompt, buildVerifyChannelPrompt, buildWebhookPrompt } from "@/lib/ai-assist-prompts";
import { channelHealthText } from "@/lib/channel-health";
import { WalletBalanceLine } from "./WalletBalanceLine";
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
  onCredentials,
  health,
  children,
}: {
  channel: Channel;
  canManage: boolean;
  busy: boolean;
  onRotate: () => void;
  onToggle: () => void;
  onPartner: () => void;
  onCredentials: () => void;
  /** Last activity of the channel; undefined while loading or when it could not be read. */
  health?: ChannelHealth | undefined;
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
      {health && channel.status !== "disabled" ? <ChannelHealthLines health={health} /> : null}
      {canManage && channel.provider === "gupshup" && channel.status !== "disabled" ? <WalletBalanceLine channelId={channel.id} /> : null}
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
          <span className="text-xs text-muted">Esta URL es privada: no la compartas. Si se filtra, usa Rotar token.</span>
          <AiAssistButton prompt={buildWebhookPrompt({ appName: channel.appName })} label="Hacerlo con IA: configurar el webhook" />
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
            <Button size="sm" variant="outline" disabled={busy} onClick={onCredentials}>
              <Pencil aria-hidden className="size-4" />Editar credenciales
            </Button>
          ) : null}
          {channel.provider === "gupshup" ? (
            <Button size="sm" variant="outline" disabled={busy} onClick={onPartner}>
              <FileText aria-hidden className="size-4" />{channel.partnerConfigured ? "Cambiar credenciales de plantillas" : "Configurar plantillas"}
            </Button>
          ) : null}
          {channel.provider === "gupshup" ? <AiAssistButton prompt={buildApiKeyPrompt({ appName: channel.appName })} label="Hacerlo con IA: API key" /> : null}
          {channel.provider === "gupshup" ? <AiAssistButton prompt={buildRechargePrompt({ appName: channel.appName })} label="Hacerlo con IA: recargar saldo" /> : null}
          {channel.provider === "gupshup" && channel.webhookUrl ? (
            <AiAssistButton
              prompt={buildVerifyChannelPrompt({ appName: channel.appName, phone: channel.phoneE164, apiKeyHint: channel.apiKeyHint })}
              label="Verificar mi canal con IA"
            />
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

export function ChannelHealthLines({ health }: { health: ChannelHealth }) {
  const t = channelHealthText(health);
  const out = t.outbound;
  return (
    <div className="flex flex-col gap-1 text-sm" data-testid="channel-health">
      <p className="m-0 flex items-center gap-2">
        <Inbox aria-hidden className="size-4 text-muted" />
        {t.inbound}
      </p>
      {t.invalidCredentials ? (
        <p className="m-0" data-testid="channel-health-credentials">
          <StatusChip label="Credenciales inv�lidas" tone="danger" />
        </p>
      ) : null}
      {out ? (
        <p className="m-0 flex flex-wrap items-center gap-2" data-testid="channel-health-outbound">
          <Send aria-hidden className="size-4 text-muted" />
          Último envío: <StatusChip label={out.ok ? "ok" : "falló"} tone={out.ok ? "success" : "danger"} />
          {out.error ? <span>— {out.error}</span> : null}
          <span className="text-muted">{out.when}</span>
        </p>
      ) : null}
    </div>
  );
}
