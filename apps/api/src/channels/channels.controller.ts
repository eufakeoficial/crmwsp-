import { Body, Controller, Get, HttpCode, Inject, Param, Patch, Post, Req, UseGuards } from "@nestjs/common";
import type { CipherBox } from "@crmwsp/crypto";
import { redact } from "@crmwsp/crypto";
import {
  ConflictError,
  EncryptionNotConfiguredError,
  NotFoundError,
  createGupshupChannelRequestSchema,
  updateChannelRequestSchema,
  type Channel,
  type ChannelListResponse,
} from "@crmwsp/contracts";
import { asc, channelConnections, eq, isUuid, type ChannelConnection } from "@crmwsp/db";
import { generateWebhookToken } from "@crmwsp/whatsapp";
import { CurrentTenant, CurrentTenantDb, Roles } from "../auth/decorators.js";
import { TenantGuard } from "../auth/tenant.guard.js";
import type { HttpRequest, RequestTenant } from "../common/http.js";
import { parseOrThrow } from "../common/zod.js";
import type { TenantDb } from "../db/tenant-db.js";
import { PG_UNIQUE_VIOLATION, pgCode, writeAudit } from "../inbox/audit.js";
import { CIPHER_BOX, GUPSHUP_API_KEY_PURPOSE, webhookUrlFor } from "./channels.constants.js";

const ADMIN_ROLES = new Set(["owner", "admin"]);

@Controller("channels")
@UseGuards(TenantGuard)
export class ChannelsController {
  constructor(@Inject(CIPHER_BOX) private readonly cipher: CipherBox | null) {}

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
      webhookUrl: privileged ? webhookUrlFor(row.webhookToken) : null,
      apiKeyHint: privileged ? (hint !== undefined ? hint : this.apiKeyHint(row)) : null,
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
    try {
      const row = await db.run(async (tx) => {
        const [created] = await tx
          .insert(channelConnections)
          .values({
            tenantId: db.tenantId,
            provider: "gupshup",
            phoneE164: input.phoneE164,
            externalAppId: input.appName,
            credentialsEncrypted: credentials,
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
