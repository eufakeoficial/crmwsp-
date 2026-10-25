"use client";

import type { Channel, MessageTemplateDto } from "@crmwsp/contracts";
import { cn } from "@/lib/cn";
import { FileText, Lock, Plus, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, PageHeader } from "@/components/app/EmptyState";
import { canManageChannels } from "@/components/app/roles";
import { useSession } from "@/components/app/SessionProvider";
import { PartnerCredentialsDialog } from "@/components/channels/PartnerCredentialsDialog";
import { Alert, Banner, Button, Card, CHIP_ROW, Chip, StatusChip, Toast, buttonClasses } from "@/components/ui";
import { useToast } from "@/lib/hooks/use-toast";
import { formatDateTime } from "@/lib/format";
import { channelsApi } from "@/lib/inbox-api";
import { channelErrorMessage, isEncryptionNotConfigured } from "@/lib/messages";
import { CATEGORY_LABELS, STATUS_META } from "@/lib/wa-templates";
import { templateErrorMessage, waTemplatesApi } from "@/lib/wa-templates-api";
import { TemplateFormDialog } from "./TemplateFormDialog";

/** A Gupshup channel needs the Partner app id + token before templates can be created or synced. */
export function needsTemplateCredentials(channel: Pick<Channel, "provider" | "partnerConfigured">): boolean {
  return channel.provider === "gupshup" && !channel.partnerConfigured;
}

function lastSync(items: readonly MessageTemplateDto[]): string | null {
  const times = items.map((t) => t.syncedAt).filter((s): s is string => s !== null);
  return times.length === 0 ? null : times.reduce((a, b) => (a > b ? a : b));
}

export function TemplatesView() {
  const { tenant } = useSession();
  const canManage = canManageChannels(tenant?.role);
  const [channels, setChannels] = useState<Channel[] | null>(null);
  const [channelId, setChannelId] = useState<string | null>(null);
  const [items, setItems] = useState<MessageTemplateDto[] | null>(null);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [error, setError] = useState<string>();
  const [syncing, setSyncing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [configuring, setConfiguring] = useState(false);
  const { message, show } = useToast();

  useEffect(() => {
    channelsApi.list().then(
      (r) => {
        setChannels(r.items);
        setChannelId((cur) => cur ?? r.items[0]?.id ?? null);
      },
      (err) => setError(channelErrorMessage(err)),
    );
  }, []);

  const channel = useMemo(() => channels?.find((c) => c.id === channelId) ?? null, [channels, channelId]);
  const noCredentials = channel ? needsTemplateCredentials(channel) : false;

  const load = useCallback(async (id: string) => {
    setItems(null);
    setReasons({});
    try {
      setItems((await waTemplatesApi.list(id)).items);
      setError(undefined);
    } catch (err) {
      setError(templateErrorMessage(err));
    }
  }, []);
  useEffect(() => {
    if (channelId) void load(channelId);
  }, [channelId, load]);

  async function sync() {
    if (!channel) return;
    setSyncing(true);
    setError(undefined);
    try {
      const r = await waTemplatesApi.sync(channel.id);
      setItems(r.items);
      setReasons(Object.fromEntries(r.rejections.map((x) => [`${x.name}\u0000${x.language}`, x.reason])));
      show(r.updated + r.imported === 0 ? "Todo está al día" : `Sincronizado: ${r.updated} actualizadas, ${r.imported} nuevas`);
    } catch (err) {
      setError(templateErrorMessage(err));
    } finally {
      setSyncing(false);
    }
  }

  const synced = items ? lastSync(items) : null;
  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader title="Plantillas de WhatsApp" subtitle="Mensajes aprobados por Meta para escribir a tus clientes fuera de la ventana de 24 horas." />
        {canManage && channel && !noCredentials ? (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={syncing} onClick={() => void sync()}>
              <RefreshCw aria-hidden className={`size-4 ${syncing ? "animate-spin" : ""}`} />Sincronizar con Meta
            </Button>
            <Button variant="accent" disabled={channel.status === "disabled"} onClick={() => setCreating(true)}>
              <Plus aria-hidden className="size-4" />Nueva plantilla
            </Button>
          </div>
        ) : null}
      </div>

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

      {channels === null && !error ? (
        <p className="text-muted" aria-busy="true">Cargando…</p>
      ) : channels && channels.length === 0 ? (
        <EmptyState title="Aún no hay canales">
          Conecta un número de WhatsApp para crear plantillas.{" "}
          <Link href="/app/channels" className={buttonClasses("accent", "mt-3", "sm")}>Ir a Canales</Link>
        </EmptyState>
      ) : channel && noCredentials ? (
        <Card className="flex flex-col items-start gap-3">
          <p className="m-0 flex items-center gap-2 font-bold"><Lock aria-hidden className="size-4" />Falta configurar las plantillas de este número</p>
          <p className="m-0 text-sm text-muted">
            Para crear y sincronizar plantillas de <b>{channel.phoneE164}</b> necesitamos el ID de app y el token de Partner de Gupshup.
          </p>
          {canManage ? (
            <Button variant="accent" onClick={() => setConfiguring(true)}><FileText aria-hidden className="size-4" />Configurar plantillas</Button>
          ) : (
            <p className="m-0 text-sm text-muted">Pide a un administrador que las configure.</p>
          )}
        </Card>
      ) : items === null && !error ? (
        <p className="text-muted" aria-busy="true">Cargando plantillas…</p>
      ) : items && items.length === 0 ? (
        <EmptyState title="Aún no hay plantillas en este canal">
          {canManage ? "Crea la primera con «Nueva plantilla», o usa «Sincronizar con Meta» si ya tienes plantillas creadas." : "Un administrador puede crear plantillas para este canal."}
        </EmptyState>
      ) : items ? (
        <>
          <p className="mt-0 mb-3 text-xs text-muted" data-testid="last-sync">
            Última sincronización: {synced ? formatDateTime(synced) : "nunca"}
          </p>
          <ul className="m-0 grid list-none gap-3 p-0 md:grid-cols-2">
            {items.map((t) => {
              const st = STATUS_META[t.status];
              const reason = reasons[`${t.name}\u0000${t.language}`];
              return (
                <li key={t.id}>
                  <Card className="flex h-full flex-col gap-2 p-4 sm:p-4" data-testid="template-card">
                    <div className="flex items-start gap-2">
                      <b className="min-w-0 flex-1 break-all">{t.name}</b>
                      <StatusChip label={st.label} tone={st.tone} />
                    </div>
                    <p className="m-0 text-xs text-muted">{CATEGORY_LABELS[t.category]} · {t.language}</p>
                    <p className="m-0 text-sm whitespace-pre-wrap">{t.body}</p>
                    {t.status === "rejected" ? (
                      <p className="m-0 text-xs font-bold text-danger">Motivo: {reason ?? "Meta no la aprobó. Sincroniza para ver el motivo."}</p>
                    ) : null}
                  </Card>
                </li>
              );
            })}
          </ul>
        </>
      ) : null}

      {!canManage && channel && !noCredentials ? (
        <div className="mt-4"><Banner tone="info" icon={Lock}>Solo propietarios y administradores pueden crear o sincronizar plantillas.</Banner></div>
      ) : null}

      {creating && channel ? (
        <TemplateFormDialog
          channelId={channel.id}
          onClose={() => setCreating(false)}
          onCreated={(t) => {
            setItems((list) => [...(list ?? []), t].sort((a, b) => a.name.localeCompare(b.name)));
            setCreating(false);
            show("Plantilla enviada a aprobación");
          }}
        />
      ) : null}
      {configuring && channel ? (
        <PartnerCredentialsDialog
          channel={channel}
          onClose={() => setConfiguring(false)}
          onNoKeys={(err) => {
            setConfiguring(false);
            setError(isEncryptionNotConfigured(err) ? channelErrorMessage(err) : templateErrorMessage(err));
          }}
          onSaved={(c) => {
            setChannels((list) => (list ?? []).map((x) => (x.id === c.id ? c : x)));
            setConfiguring(false);
            show("Credenciales de plantillas guardadas");
          }}
        />
      ) : null}
      <Toast message={message} />
    </>
  );
}
