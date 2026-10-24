import { createHash, randomBytes } from "node:crypto";
import { Body, Controller, Get, HttpCode, Inject, Optional, Param, Patch, Post, Put, Req, UseGuards } from "@nestjs/common";
import type { CipherBox } from "@crmwsp/crypto";
import { redact } from "@crmwsp/crypto";
import {
  ConflictError,
  EncryptionNotConfiguredError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  GUPSHUP_PARTNER_TOKEN_PURPOSE,
  connect360dialogRequestSchema,
  createGupshupChannelRequestSchema,
  setPartnerCredentialsRequestSchema,
  submitTemplateRequestSchema,
  templateLintRequestSchema,
  type TemplateLintResponse,
  updateChannelRequestSchema,
  type Channel,
  type ChannelListResponse,
  type Dialog360Config,
  type Dialog360ConnectState,
  type MessageTemplateDto,
  type MessageTemplateListResponse,
  type SyncTemplatesResponse,
} from "@crmwsp/contracts";
import { and, asc, channelConnections, eq, inArray, isUuid, messageTemplates, sql, type ChannelConnection, type MessageTemplate, type Transaction } from "@crmwsp/db";
import { lintTemplate } from "@crmwsp/domain";
import { planTemplateSync } from "../templates/sync-plan.js";
import { generateWebhookToken, type Dialog360PartnerClient, type WhatsAppProvider } from "@crmwsp/whatsapp";
import { CurrentTenant, CurrentTenantDb, Roles } from "../auth/decorators.js";
import { TenantGuard } from "../auth/tenant.guard.js";
import type { HttpRequest, RequestTenant } from "../common/http.js";
import { parseOrThrow } from "../common/zod.js";
import type { TenantDb } from "../db/tenant-db.js";
import { ActivationGuard } from "../billing/activation.guard.js";
import { PlanLimitsService } from "../billing/plan-limits.service.js";
import { PG_UNIQUE_VIOLATION, pgCode, writeAudit } from "../inbox/audit.js";
import { BusinessCategoryService, CATEGORY_REVIEW_BLOCKS_CHANNELS } from "../settings/business-category.service.js";
import { CHANNEL_PROVIDER, CIPHER_BOX, DIALOG360_PARTNER, GUPSHUP_API_KEY_PURPOSE, webhookUrlFor } from "./channels.constants.js";

function redactedHint(row: ChannelConnection, cipher: CipherBox): string | null {
  if (!row.credentialsEncrypted) return null;
  try {
    return redact(cipher.decrypt(row.credentialsEncrypted, { tenantId: row.tenantId, purpose: GUPSHUP_API_KEY_PURPOSE }));
  } catch {
    return null;
  }
}

function toTemplateDto(row: MessageTemplate): MessageTemplateDto {
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
}

const ADMIN_ROLES =new Set(["owner", "admin"]);

/** Lifetime of a 360dialog Connect `state` (the user completes Embedded Signup within it). */
export const CONNECT_STATE_TTL_SECONDS = 900;

/** SHA-256 of the connect state: the raw value never reaches the database. */
export function hashConnectState(state: string): Buffer {
  return createHash("sha256").update(state, "utf8").digest();
}

/** The part of PlanLimitsService the channels need (stubbed in unit tests). */
export type ChannelPlanLimits = Pick<PlanLimitsService, "assert" | "lock" | "startTrialIfEligible">;

@Controller("channels")
@UseGuards(TenantGuard)
export class ChannelsController {
  constructor(
    @Inject(CIPHER_BOX) private readonly cipher: CipherBox | null,
    @Inject(CHANNEL_PROVIDER) private readonly provider: WhatsAppProvider,
    @Inject(DIALOG360_PARTNER) private readonly partner: Dialog360PartnerClient | null,
    @Inject(PlanLimitsService) private readonly limits: ChannelPlanLimits,
    @Optional() @Inject(BusinessCategoryService) private readonly categories?: Pick<BusinessCategoryService, "assertCanConnect">,
  ) {}

  /** ADR 0021: no new number while the business category review is pending or rejected (DB trigger too). */
  private async assertCategory(db: TenantDb): Promise<void> {
    if (this.categories) await this.categories.assertCanConnect(db);
  }

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
      qualityRating: row.qualityRating ?? null,
      accountStatus: row.accountStatus ?? "ok",
      messagingLimit: row.messagingLimit ?? null,
      qualityUpdatedAt: row.qualityUpdatedAt ? row.qualityUpdatedAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  @Post("gupshup")
  @Roles("owner", "admin")
  async createGupshup(@CurrentTenantDb() db: TenantDb, @Body() body: unknown, @Req() req: HttpRequest): Promise<Channel> {
    const input = parseOrThrow(createGupshupChannelRequestSchema, body);
    if (!this.cipher) throw new EncryptionNotConfiguredError();
    await this.assertCategory(db);
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
        await this.limits.startTrialIfEligible(tx, created);
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
      if (pgCode(err) === "42501") throw new ForbiddenError(CATEGORY_REVIEW_BLOCKS_CHANNELS);
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
   * Issues the single-use `state` the web app puts in the Connect redirect. Only its SHA-256 is stored,
   * bound to this tenant + user, valid for CONNECT_STATE_TTL_SECONDS.
   */
  @Post("360dialog/connect-state")
  @Roles("owner", "admin")
  @HttpCode(200)
  async dialog360ConnectState(@CurrentTenantDb() db: TenantDb): Promise<Dialog360ConnectState> {
    if (!this.partner) throw new EncryptionNotConfiguredError("360dialog partner credentials are not configured");
    const state = randomBytes(32).toString("base64url");
    const expiresAt = await db.run(async (tx) => {
      const [r] = await tx.execute<{ e: string | null }>(
        sql`select public.channel_connect_state_issue('360dialog', ${hashConnectState(state)}, ${CONNECT_STATE_TTL_SECONDS})::text as e`,
      );
      return r?.e ?? null;
    });
    if (!expiresAt) throw new Error("connect state could not be issued");
    return { state, expiresAt: new Date(expiresAt).toISOString() };
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
    const stateHash = hashConnectState(input.state);

    // 1) The redirect must carry a state this tenant + user was issued (unused, unexpired).
    const stateOk = await db.run(async (tx) => {
      const [r] = await tx.execute<{ ok: boolean }>(sql`select public.channel_connect_state_check('360dialog', ${stateHash}) as ok`);
      return r?.ok === true;
    });
    if (!stateOk) throw new ForbiddenError("Invalid or expired 360dialog connect state", { details: { reason: "connect_state_invalid" } });

    // 2) Cross-tenant ownership, before ANY Partner API call: minting a key for a channel connected by
    // another tenant would revoke its key and hijack its inbound traffic.
    const ownedElsewhere = await db.run(async (tx) => {
      const rows = await tx.execute<{ id: string }>(
        sql`select x as id from public.channel_external_owned_elsewhere('360dialog', ARRAY[${sql.join(channelIds.map((id) => sql`${id}`), sql`, `)}]::text[]) as x`,
      );
      return [...rows].map((r) => r.id);
    });
    if (ownedElsewhere.length > 0) {
      await db.run((tx) =>
        writeAudit(tx, {
          tenantId: db.tenantId,
          userId: db.userId,
          entity: "tenant",
          entityId: db.tenantId,
          action: "channel.connect_refused",
          diff: { provider: "360dialog", reason: "owned_by_another_tenant", channelIds: ownedElsewhere, clientId: input.clientId },
          ip: req.ip,
        }),
      );
      throw new ConflictError("This 360dialog channel is already connected to another account", { details: { reason: "channel_owned_elsewhere" } });
    }

    const existing = await db.run((tx) =>
      tx
        .select()
        .from(channelConnections)
        .where(and(eq(channelConnections.provider, "360dialog"), inArray(channelConnections.externalAppId, channelIds))),
    );
    const known = new Set(existing.map((r) => r.externalAppId));
    const items: ChannelConnection[] = [...existing];
    const pending = channelIds.filter((id) => !known.has(id));
    // Fail before any Partner API call: an API key must not be minted for a channel we cannot store.
    if (pending.length > 0) await this.assertCategory(db);
    if (pending.length > 0) await db.run((tx) => this.limits.assert(db.tenantId, "whatsapp_numbers", pending.length, tx));

    // 3) Read-only Partner check: every new channel must belong to the client of this redirect.
    const phones = new Map<string, string>();
    for (const channelId of pending) {
      const info = await partner.getChannel(channelId);
      if (!info || info.clientId !== input.clientId) {
        await db.run((tx) =>
          writeAudit(tx, {
            tenantId: db.tenantId,
            userId: db.userId,
            entity: "tenant",
            entityId: db.tenantId,
            action: "channel.connect_refused",
            diff: { provider: "360dialog", reason: "client_mismatch", channelId, clientId: input.clientId },
            ip: req.ip,
          }),
        );
        throw new ForbiddenError("The 360dialog channel does not belong to this client", { details: { reason: "channel_client_mismatch" } });
      }
      const phone = info.phone ?? (channelIds.length === 1 ? input.phoneE164 : undefined);
      if (!phone) throw new ValidationError("phoneE164 is required: the phone number of the channel could not be determined");
      phones.set(channelId, phone);
    }

    // 4) Consume the state atomically right before minting keys: a replay cannot mint again.
    const consumed = await db.run(async (tx) => {
      const [r] = await tx.execute<{ ok: boolean }>(sql`select public.channel_connect_state_consume('360dialog', ${stateHash}) as ok`);
      return r?.ok === true;
    });
    if (!consumed) throw new ForbiddenError("Invalid or expired 360dialog connect state", { details: { reason: "connect_state_invalid" } });

    for (const channelId of pending) {
      const phone = phones.get(channelId) as string;
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
          await this.limits.startTrialIfEligible(tx, created);
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

  /** Pre-submit linter (ADR 0021): errors block the submission, warnings are advice. */
  @Post("templates/lint")
  @HttpCode(200)
  lint(@Body() body: unknown): TemplateLintResponse {
    return lintTemplate(parseOrThrow(templateLintRequestSchema, body));
  }

  @Post(":id/templates")
  @UseGuards(ActivationGuard)
  @Roles("owner", "admin")
  async submitTemplate(
    @CurrentTenantDb() db: TenantDb,
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() req: HttpRequest,
  ): Promise<MessageTemplateDto> {
    if (!isUuid(id)) throw new NotFoundError();
    const input = parseOrThrow(submitTemplateRequestSchema, body);
    const lint = lintTemplate({ category: input.category, body: input.body });
    if (!lint.ok) throw new ValidationError("The template does not pass the policy linter", { details: { issues: lint.issues } });
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

  /** Every template of the channel, any status. Read-only: all roles may list. */
  @Get(":id/templates")
  async listTemplates(@CurrentTenantDb() db: TenantDb, @Param("id") id: string): Promise<MessageTemplateListResponse> {
    if (!isUuid(id)) throw new NotFoundError();
    const items = await db.run(async (tx) => {
      const [ch] = await tx.select({ id: channelConnections.id }).from(channelConnections).where(eq(channelConnections.id, id));
      if (!ch) throw new NotFoundError();
      const rows = await tx.select().from(messageTemplates).where(eq(messageTemplates.channelConnectionId, id)).orderBy(asc(messageTemplates.name), asc(messageTemplates.language));
      return rows.map(toTemplateDto);
    });
    return { items };
  }

  /** On-demand reconciliation with the BSP listing (the worker does the same periodically). */
  @Post(":id/templates/sync")
  @HttpCode(200)
  @Roles("owner", "admin")
  async syncTemplates(@CurrentTenantDb() db: TenantDb, @Param("id") id: string): Promise<SyncTemplatesResponse> {
    if (!isUuid(id)) throw new NotFoundError();
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
      return ch;
    });
    if (channel.provider !== "gupshup" && channel.provider !== "360dialog") throw new ValidationError("template sync is not supported for this channel");
    if (!channel.credentials || !channel.appName) throw new ValidationError("channel has no credentials");
    if (channel.provider === "gupshup" && (!channel.partnerAppId || !channel.partnerToken)) {
      throw new ValidationError("channel has no Gupshup partner credentials (app id and token); set them with PUT /channels/:id/partner-credentials");
    }
    const apiKey = this.cipher.decrypt(channel.credentials, { tenantId: db.tenantId, purpose: GUPSHUP_API_KEY_PURPOSE });
    const partnerToken = channel.partnerToken ? this.cipher.decrypt(channel.partnerToken, { tenantId: db.tenantId, purpose: GUPSHUP_PARTNER_TOKEN_PURPOSE }) : undefined;
    // BSP call outside any transaction.
    const remote = await this.provider.listTemplates({
      provider: channel.provider,
      apiKey,
      appName: channel.appName,
      sourcePhone: channel.phoneE164,
      ...(channel.partnerAppId ? { partnerAppId: channel.partnerAppId } : {}),
      ...(partnerToken ? { partnerToken } : {}),
    });
    return db.run(async (tx) => {
      const now = new Date();
      const local = await tx.select().from(messageTemplates).where(eq(messageTemplates.channelConnectionId, id));
      const plan = planTemplateSync(local, remote);
      for (const u of plan.updates) {
        await tx.update(messageTemplates).set({ status: u.status, externalId: u.externalId, syncedAt: now, updatedAt: now }).where(eq(messageTemplates.id, u.id));
      }
      if (plan.inserts.length > 0) {
        await tx
          .insert(messageTemplates)
          .values(
            plan.inserts.map((r) => ({
              tenantId: db.tenantId,
              channelConnectionId: id,
              name: r.name,
              language: r.language,
              category: r.category,
              status: r.status,
              body: r.body,
              externalId: r.externalId,
              syncedAt: now,
            })),
          )
          .onConflictDoNothing();
      }
      const rows = await tx.select().from(messageTemplates).where(eq(messageTemplates.channelConnectionId, id)).orderBy(asc(messageTemplates.name), asc(messageTemplates.language));
      return { updated: plan.updates.length, imported: plan.inserts.length, rejections: plan.rejections, items: rows.map(toTemplateDto) };
    });
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
      if (updated.status === "active") await this.limits.startTrialIfEligible(tx, updated);
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
