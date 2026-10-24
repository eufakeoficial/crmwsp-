import { channelConnections, channelQualityEvents, messageTemplates, notifications, withTenant } from "@crmwsp/db";
import { assessAccountEvent, templateStatusFromEvent, type AccountEventSeverity } from "@crmwsp/domain";
import { UnrecoverableError } from "bullmq";
import { and, eq } from "drizzle-orm";
import { notifyPlatformAdmins } from "./platform-alerts.js";
import { loadResult, markProcessed, parseInboundJobData, type ProcessorDeps } from "./processors.js";

export interface IngestAccountResult {
  severity: AccountEventSeverity;
  recorded: boolean;
}

const FIELD_LABEL: Record<string, string> = {
  phone_number_quality_update: "Calidad del número",
  account_update: "Estado de la cuenta",
  message_template_status_update: "Estado de una plantilla",
  message_template_quality_update: "Calidad de una plantilla",
};

/**
 * Applies a Meta account/number/template event (ADR 0021, T2d): stores it, updates the channel's
 * quality/account status and the template status, and alerts the owner (notification) on
 * warning/critical and the platform admins (e-mail) on critical. Idempotent per inbound event.
 */
export async function processIngestAccount(deps: ProcessorDeps, data: unknown): Promise<IngestAccountResult> {
  const { eventId, tenantId } = parseInboundJobData(data);
  const out = await withTenant(deps.db, tenantId, async (tx) => {
    const { event, result } = await loadResult(tx, deps.provider, eventId, "account");
    const a = result.account;
    const channelId = event.channelConnectionId;
    if (!channelId) throw new UnrecoverableError("inbound event has no channel connection");
    const assessed = assessAccountEvent({ field: a.field, event: a.event, quality: a.quality });

    const [row] = await tx
      .insert(channelQualityEvents)
      .values({
        tenantId,
        channelConnectionId: channelId,
        inboundEventId: eventId,
        field: a.field,
        event: a.event,
        quality: a.quality,
        messagingLimit: a.messagingLimit,
        templateName: a.templateName,
        templateLanguage: a.templateLanguage,
        reason: a.reason,
        severity: assessed.severity,
      })
      .onConflictDoNothing()
      .returning({ id: channelQualityEvents.id });
    if (!row) {
      await markProcessed(tx, eventId);
      return { severity: assessed.severity, recorded: false, label: "" };
    }

    const now = new Date();
    if (assessed.quality || assessed.accountStatus || a.messagingLimit) {
      await tx
        .update(channelConnections)
        .set({
          ...(assessed.quality ? { qualityRating: assessed.quality } : {}),
          ...(assessed.accountStatus ? { accountStatus: assessed.accountStatus } : {}),
          ...(a.messagingLimit ? { messagingLimit: a.messagingLimit } : {}),
          qualityUpdatedAt: now,
          updatedAt: now,
        })
        .where(eq(channelConnections.id, channelId));
    }
    const tplStatus = a.field === "message_template_status_update" ? templateStatusFromEvent(a.event) : null;
    if (tplStatus && a.templateName) {
      await tx
        .update(messageTemplates)
        .set({ status: tplStatus, updatedAt: now })
        .where(
          and(
            eq(messageTemplates.channelConnectionId, channelId),
            eq(messageTemplates.name, a.templateName),
            ...(a.templateLanguage ? [eq(messageTemplates.language, a.templateLanguage)] : []),
          ),
        );
    }
    const [ch] = await tx.select({ phone: channelConnections.phoneE164 }).from(channelConnections).where(eq(channelConnections.id, channelId));
    const label = `${FIELD_LABEL[a.field] ?? a.field}: ${a.event ?? a.quality ?? "actualización"}${a.templateName ? ` (${a.templateName})` : ""} · número …${(ch?.phone ?? "").slice(-4)}`;
    if (assessed.severity !== "info") {
      await tx
        .insert(notifications)
        .values({
          tenantId,
          kind: "channel_quality",
          title: assessed.severity === "critical" ? "WhatsApp restringió o degradó tu número" : "Atención: calidad de WhatsApp",
          body: `${label}${a.reason ? ` · motivo: ${a.reason}` : ""}. Revisa tus envíos y plantillas.`.slice(0, 1000),
          entity: "channel_connection",
          entityId: channelId,
          dedupeKey: `channel_quality:${row.id}`,
        })
        .onConflictDoNothing({ target: [notifications.tenantId, notifications.dedupeKey] });
    }
    await markProcessed(tx, eventId);
    return { severity: assessed.severity, recorded: true, label };
  });

  if (out.recorded && out.severity === "critical") {
    await notifyPlatformAdmins(
      deps.db,
      deps.alertMailer,
      "[Vende+ WSP] Alerta de calidad/restricción de WhatsApp",
      `Un tenant recibió un evento crítico de Meta.\n\nTenant: ${tenantId}\n${out.label}\n\nRevisa el backoffice: Políticas de WhatsApp.`,
      deps.logger,
    );
  }
  return { severity: out.severity, recorded: out.recorded };
}
