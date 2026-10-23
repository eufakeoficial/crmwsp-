"use client";

import type { Channel } from "@crmwsp/contracts";
import { FileText, KeyRound, Power, RefreshCw } from "lucide-react";
import { Button, Card, StatusChip, type Tone } from "@/components/ui";
import { WebhookUrlBox } from "./WebhookUrlBox";

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
}: {
  channel: Channel;
  canManage: boolean;
  busy: boolean;
  onRotate: () => void;
  onToggle: () => void;
  onPartner: () => void;
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
      {canManage && channel.webhookUrl ? (
        <div className="flex flex-col gap-1">
          <span className="text-xs font-extrabold text-muted">URL de webhook (Gupshup → Callback URL)</span>
          <WebhookUrlBox url={channel.webhookUrl} />
        </div>
      ) : null}
      {canManage ? (
        <div className="flex flex-wrap gap-2 border-t border-line pt-3">
          <Button size="sm" variant="outline" disabled={busy} onClick={onRotate}>
            <RefreshCw aria-hidden className="size-4" />Rotar token
          </Button>
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
    </Card>
  );
}
