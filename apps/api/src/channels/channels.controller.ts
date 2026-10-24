import { Body, Controller, Get, HttpCode, Inject, Param, Patch, Post, Put, Req, UseGuards } from "@nestjs/common";
import type { CipherBox } from "@crmwsp/crypto";
import { redact } from "@crmwsp/crypto";
import {
  ConflictError,
  EncryptionNotConfiguredError,
  NotFoundError,
  ValidationError,
  GUPSHUP_PARTNER_TOKEN_PURPOSE,
  connect360dialogRequestSchema,
  createGupshupChannelRequestSchema,
  setPartnerCredentialsRequestSchema,
  submitTemplateRequestSchema,
  updateChannelRequestSchema,
  type Channel,
  type ChannelListResponse,
  type Dialog360Config,
  type MessageTemplateDto,
} from "@crmwsp/contracts";
import { and, asc, channelConnections, eq, inArray, isUuid, messageTemplates, type ChannelConnection, type Transaction } from "@crmwsp/db";
import { generateWebhookToken, type Dialog360PartnerClient, type WhatsAppProvider } from "@crmwsp/whatsapp";
import { CurrentTenant, CurrentTenantDb, Roles } from "../auth/decorators.js";
import { TenantGuard } from "../auth/tenant.guard.js";
import type { HttpRequest, RequestTenant } from "../common/http.js";
import { parseOrThrow } from "../common/zod.js";
import type { TenantDb } from "../db/tenant-db.js";
import { PlanLimitsService } from "../billing/plan-limits.service.js";
import { PG_UNIQUE_VIOLATION, pgCode, writeAudit } from "../inbox/audit.js";
import { CHANNEL_PROVIDER, CIPHER_BOX, DIALOG360_PARTNER, GUPSHUP_API_KEY_PURPOSE, webhookUrlFor } from "./channels.constants.js";

function redactedHint(row: ChannelConnection, cipher: CipherBox): string | null {
  if (!row.credentialsEncrypted) return null;
  try {
    return redact(cipher.decrypt(row.credentialsEncrypted, { tenantId: row.tenantId, purpose: GUPSHUP_API_KEY_PURPOSE }));
  } catch {
    return null;
  }
}

const ADMIN_ROLES = new Set(["owner", "admin"]);

/** The part of PlanLimitsService the channels need (stubbed in unit tests). */
export type ChannelPlanLimits = Pick<PlanLimitsService, "assert" | "lock">;

@Controller("channels")
@UseGuards(TenantGuard)
export class ChannelsController {
  constructor(
    @Inject(CIPHER_BOX) private readonly cipher: CipherBox | null,
    @Inject(CHANNEL_PROVIDER) private readonly provider: WhatsAppProvider,
    @Inject(DIALOG360_PARTNER) private readonly partner: Dialog360PartnerClient | null,
    @Inject(PlanLimitsService) private readonly limits: ChannelPlanLimits,
  ) {}

  /** Every active (non-disabled) channel uses one `whatsapp_numbers` unit of the plan. */
  private async assertNumbers(tx: Transaction, tenantId: string, amount: number): Promise<void> {
    await this.limits.lock(tx, tenantId, "whatsapp_numbers");
    await this.limits.assert(tenantId, "whatsapp_numbers", amount, tx);
  }

  private apiKeyHint(row: ChannelConnection): string | null {
    if (!this.cipher || !row.credentialsEncrypted) return null;
    try {
      return redact(this.cipher.decrypt(row.credentialsEncrypted, { tenantId: row.tenantId, purpose: GUPSHUP_API_KEY_PURPOSE }));
    } catch {
      return null;
    }
  }

  private toDto(row: ChannelConnection, privileged: boolean, hint?: string | null): Channel {
    return {
      id: row.id,
      provider: row.provider,
      phoneE164: row.phoneE164,
      appName: row.externalAppId,
      status: row.status,
      webhookUrl: privileged ? webhookUrlFor(row.webhookToken, row.provider) : null,
      apiKeyHint: privileged ? (hint !== undefined ? hint : this.apiKeyHint(row)) : null,
      gupshupAppId: privileged ? row.gupshupAppId : null,
      partnerConfigured: row.gupshupAppId !== null && row.partnerTokenEncrypted !== null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  @Post("gupshup")
  @Roles("owner", "admin")
  async createGupshup(@CurrentTenantDb() db: TenantDb, @Body() body: unknown, @Req() req: HttpRequest): Promise<Channel> {
    const input = parseOrThrow(createGupshupChannelRequestSchema, body);
    if (!this.cipher) throw new EncryptionNotConfiguredError();
    const credentials = this.cipher.encrypt(input.apiKey, { tenantId: db.tenantId, purpose: GUPSHUP_API_KEY_PURPOSE });
    const partnerToken = input.partnerToken ? this.cipher.encrypt(input.partnerToken, { tenantId: db.tenantId, purpose: GUPSHUP_PARTNER_TOKEN_PURPOSE }) : null;
    try {
      const row = await db.run(async (tx) => {
        await this.assertNumbers(tx, db.tenantId, 1);
        const [created] = await tx
          .insert(channelConnections)
          .values({
            tenantId: db.tenantId,
            provider: "gupshup",
            phoneE164: input.phoneE164,
            externalAppId: input.appName,
            credentialsEncrypted: credentials,
            ...(partnerToken ? { gupshupAppId: input.gupshupAppId ?? null, partnerTokenEncrypted: partnerToken } : {}),
            webhookToken: generateWebhookToken(),
            status: "active",
          })
          .returning();
        if (!created) throw new Error("insert returned no row");
        await writeAudit(tx, {
          tenantId: db.tenantId,
          userId: db.userId,
          entity: "channel_connection",
          entityId: created.id,
          action: "channel.created",
          diff: { provider: "gupshup", phoneE164: input.phoneE164, appName: input.appName, status: "active" },
          ip: req.ip,
        });
        return created;
      });
      return this.toDto(row, true, redact(input.apiKey));
    } catch (err) {
      if (pgCode(err) === PG_UNIQUE_VIOLATION) throw new ConflictError("A channel with this phone already exists");
      throw err;
    }
  }

  /** Public partner id (not a secret) so the web app can build the 360dialog Connect URL. */
  @Get("360dialog/config")
  @Roles("owner", "admin")
  dialog360Config(): Dialog360Config {
    return { partnerId: this.partner ? (process.env["D360_PARTNER_ID"] ?? null) : null };
  }

  /**
   * 360dialog Connect callback (Embedded Signup, Coexistence): for each connected channel, creates its API
   * key through the Partner API, stores it encrypted, points the channel webhook at our tokenized URL and
   * creates the channel_connections row. Channels already connected for this tenant are returned untouched
   * (regenerating a key would revoke the one in use). Partner API calls run outside any transaction.
   */
  @Post("360dialog/connect")
  @Roles("owner", "admin")
  @HttpCode(200)
  async connect360dialog(@CurrentTenantDb() db: TenantDb, @Body() body: unknown, @Req() req: HttpRequest): Promise<ChannelListResponse> {
    const input = parseOrThrow(connect360dialogRequestSchema, body);
    const cipher = this.cipher;
    if (!cipher) throw new EncryptionNotConfiguredError();
    const partner = this.partner;
    if (!partner) throw new EncryptionNotConfiguredError("360dialog partner credentials are not configured");
    const channelIds = [...new Set(input.channelIds)];

    const existing = await db.run((tx) =>
      tx
        .select()
        .from(channelConnections)
        .where(and(eq(channelConnections.provider, "360dialog"), inArray(channelConnections.externalAppId, channelIds))),
    );
    const known = new Set(existing.map((r) => r.externalAppId));
    const items: ChannelConnection[] = [...existing];
    const toCreate = channelIds.filter((id) => !known.has(id)).length;
    // Fail before any Partner API call: an API key must not be minted for a channel we cannot store.
    if (toCreate > 0) await db.run((tx) => this.limits.assert(db.tenantId, "whatsapp_numbers", toCreate, tx));

    for (const channelId of channelIds) {
      if (known.has(channelId)) continue;
      const phone = (await partner.findChannelPhone(channelId)) ?? (channelIds.length === 1 ? input.phoneE164 : undefined);
      if (!phone) throw new ValidationError("phoneE164 is required: the phone number of the channel could not be determined");
      const apiKey = await partner.createChannelApiKey(channelId);
      const webhookToken = generateWebhookToken();
      await partner.setWebhook(apiKey, webhookUrlFor(webhookToken, "360dialog"));
      const credentials = cipher.encrypt(apiKey, { tenantId: db.tenantId, purpose: GUPSHUP_API_KEY_PURPOSE });
      try {
        const row = await db.run(async (tx) => {
          await this.assertNumbers(tx, db.tenantId, 1);
          const [created] = await tx
            .insert(channelConnections)
            .values({
              tenantId: db.tenantId,
              provider: "360dialog",
              phoneE164: phone,
              externalAppId: channelId,
              credentialsEncrypted: credentials,
              webhookToken,
              status: "active",
            })
            .returning();
          if (!created) throw new Error("insert returned no row");
          await writeAudit(tx, {
            tenantId: db.tenantId,
            userId: db.userId,
            entity: "channel_connection",
            entityId: created.id,
            action: "channel.created",
            diff: { provider: "360dialog", phoneE164: phone, channelId, status: "active" },
            ip: req.ip,
          });
          return created;
        });
        items.push(row);
      } catch (err) {
        if (pgCode(err) === PG_UNIQUE_VIOLATION) throw new ConflictError("A channel with this phone already exists");
        throw err;
      }
    }
    return { items: items.map((r) => this.toDto(r, true, redactedHint(r, cipher))) };
  }

  @Get()
  async list(@CurrentTenantDb() db: TenantDb, @CurrentTenant() tenant: RequestTenant): Promise<ChannelListResponse> {
    const rows = await db.run((tx) =>
      tx.select().from(channelConnections).orderBy(asc(channelConnections.createdAt), asc(channelConnections.id)),
    );
    const privileged = ADMIN_ROLES.has(tenant.role);
    return { items: rows.map((r) => this.toDto(r, privileged)) };
  }

  @Post(":id/rotate-webhook-token")
  @Roles("owner", "admin")
  @HttpCode(200)
  async rotate(@CurrentTenantDb() db: TenantDb, @Param("id") id: string, @Req() req: HttpRequest): Promise<Channel> {
    if (!isUuid(id)) throw new NotFoundError();
    const row = await db.run(async (tx) => {
      const [updated] = await tx
        .update(channelConnections)
        .set({ webhookToken: generateWebhookToken(), updatedAt: new Date() })
        .where(eq(channelConnections.id, id))
        .returning();
      if (!updated) throw new NotFoundError();
      await writeAudit(tx, {
        tenantId: db.tenantId,
        userId: db.userId,
        entity: "channel_connection",
        entityId: id,
        action: "channel.webhook_token_rotated",
        ip: req.ip,
      });
      return updated;
    });
    return this.toDto(row, true);
  }

  /**
   * Submits a WhatsApp template to Meta review through the BSP. The BSP call runs between two short
   * transactions (never inside one); the row is stored with the status the BSP answered, and the
   * worker's periodic sync keeps it up to date afterwards.
   */
  /** Stores the Gupshup Partner app id + (encrypted) app token used for templates. The token is never returned. */
  @Put(":id/partner-credentials")
  @Roles("owner", "admin")
  async setPartnerCredentials(
    @CurrentTenantDb() db: TenantDb,
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() req: HttpRequest,
  ): Promise<Channel> {
    if (!isUuid(id)) throw new NotFoundError();
    const input = parseOrThrow(setPartnerCredentialsRequestSchema, body);
    if (!this.cipher) throw new EncryptionNotConfiguredError();
    const token = this.cipher.encrypt(input.partnerToken, { tenantId: db.tenantId, purpose: GUPSHUP_PARTNER_TOKEN_PURPOSE });
    const row = await db.run(async (tx) => {
      const [updated] = await tx
        .update(channelConnections)
        .set({ gupshupAppId: input.gupshupAppId, partnerTokenEncrypted: token, updatedAt: new Date() })
        .where(eq(channelConnections.id, id))
        .returning();
      if (!updated) throw new NotFoundError();
      await writeAudit(tx, {
        tenantId: db.tenantId,
        userId: db.userId,
        entity: "channel_connection",
        entityId: id,
        action: "channel.partner_credentials_set",
        diff: { gupshupAppId: input.gupshupAppId },
        ip: req.ip,
      });
      return updated;
    });
    return this.toDto(row, true);
  }

  @Post(":id/templates")
  @Roles("owner", "admin")
  async submitTemplate(
    @CurrentTenantDb() db: TenantDb,
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() req: HttpRequest,
  ): Promise<MessageTemplateDto> {
    if (!isUuid(id)) throw new NotFoundError();
    const input = parseOrThrow(submitTemplateRequestSchema, body);
    if (!this.cipher) throw new EncryptionNotConfiguredError();

    const channel = await db.run(async (tx) => {
      const [ch] = await tx
        .select({
          provider: channelConnections.provider,
          status: channelConnections.status,
          phoneE164: channelConnections.phoneE164,
          appName: channelConnections.externalAppId,
          credentials: channelConnections.credentialsEncrypted,
          partnerAppId: channelConnections.gupshupAppId,
          partnerToken: channelConnections.partnerTokenEncrypted,
        })
        .from(channelConnections)
        .where(eq(channelConnections.id, id));
      if (!ch) throw new NotFoundError();
      const [dup] = await tx
        .select({ id: messageTemplates.id })
        .from(messageTemplates)
        .where(
          and(
            eq(messageTemplates.channelConnectionId, id),
            eq(messageTemplates.name, input.name),
            eq(messageTemplates.language, input.language),
          ),
        );
      if (dup) throw new ConflictError("A template with this name and language already exists on this channel");
      return ch;
    });
    if (channel.provider !== "gupshup" && channel.provider !== "360dialog") throw new ValidationError("template submission is not supported for this channel");
    if (channel.status === "disabled") throw new ValidationError("channel is disabled");
    if (!channel.credentials || !channel.appName) throw new ValidationError("channel has no credentials");
    if (channel.provider === "gupshup" && (!channel.partnerAppId || !channel.partnerToken)) {
      throw new ValidationError("channel has no Gupshup partner credentials (app id and token); set them with PUT /channels/:id/partner-credentials");
    }

    const apiKey = this.cipher.decrypt(channel.credentials, { tenantId: db.tenantId, purpose: GUPSHUP_API_KEY_PURPOSE });
    const partnerToken = channel.partnerToken ? this.cipher.decrypt(channel.partnerToken, { tenantId: db.tenantId, purpose: GUPSHUP_PARTNER_TOKEN_PURPOSE }) : undefined;
    // Provider errors are ExternalProviderError (HTTP mapped by the global filter); they never carry the key.
    const submitted = await this.provider.submitTemplate(
      {
        provider: channel.provider,
        apiKey,
        appName: channel.appName,
        sourcePhone: channel.phoneE164,
        ...(channel.partnerAppId ? { partnerAppId: channel.partnerAppId } : {}),
        ...(partnerToken ? { partnerToken } : {}),
      },
      {
        name: input.name,
        language: input.language,
        category: input.category,
        body: input.body,
        ...(input.example !== undefined ? { example: input.example } : {}),
      },
    );

    try {
      const row = await db.run(async (tx) => {
        const now = new Date();
        const [created] = await tx
          .insert(messageTemplates)
          .values({
            tenantId: db.tenantId,
            channelConnectionId: id,
            name: input.name,
            language: input.language,
            category: input.category,
            status: submitted.status,
            body: input.body,
            variables: [],
            externalId: submitted.externalId,
            syncedAt: now,
          })
          .returning();
        if (!created) throw new Error("insert returned no row");
        await writeAudit(tx, {
          tenantId: db.tenantId,
          userId: db.userId,
          entity: "message_template",
          entityId: created.id,
          action: "template.submitted",
          diff: { name: input.name, language: input.language, category: input.category, status: submitted.status },
          ip: req.ip,
        });
        return created;
      });
      return {
        id: row.id,
        channelConnectionId: row.channelConnectionId,
        name: row.name,
        language: row.language,
        category: row.category,
        status: row.status,
        body: row.body,
        externalId: row.externalId,
        syncedAt: row.syncedAt ? row.syncedAt.toISOString() : null,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      };
    } catch (err) {
      if (pgCode(err) === PG_UNIQUE_VIOLATION) throw new ConflictError("A template with this name and language already exists on this channel");
      throw err;
    }
  }

  @Patch(":id")
  @Roles("owner", "admin")
  async update(
    @CurrentTenantDb() db: TenantDb,
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() req: HttpRequest,
  ): Promise<Channel> {
    if (!isUuid(id)) throw new NotFoundError();
    const input = parseOrThrow(updateChannelRequestSchema, body);
    const row = await db.run(async (tx) => {
      const [before] = await tx
        .select({ status: channelConnections.status })
        .from(channelConnections)
        .where(eq(channelConnections.id, id))
        .for("update");
      if (!before) throw new NotFoundError();
      // Re-enabling a disabled channel takes a number slot again.
      if (before.status === "disabled" && input.status !== "disabled") await this.assertNumbers(tx, db.tenantId, 1);
      const [updated] = await tx
        .update(channelConnections)
        .set({ status: input.status, updatedAt: new Date() })
        .where(eq(channelConnections.id, id))
        .returning();
      if (!updated) throw new NotFoundError();
      await writeAudit(tx, {
        tenantId: db.tenantId,
        userId: db.userId,
        entity: "channel_connection",
        entityId: id,
        action: "channel.status_changed",
        diff: { status: { from: before.status, to: input.status } },
        ip: req.ip,
      });
      return updated;
    });
    return this.toDto(row, true);
  }
}
