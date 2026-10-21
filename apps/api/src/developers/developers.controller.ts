import { randomBytes } from "node:crypto";
import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, Req, UseGuards } from "@nestjs/common";
import {
  EncryptionNotConfiguredError,
  NotFoundError,
  ValidationError,
  createApiKeyRequestSchema,
  createWebhookEndpointRequestSchema,
  updateWebhookEndpointRequestSchema,
  type ApiKeyList,
  type ApiKeyScope,
  type ApiKeyView,
  type CreatedApiKey,
  type CreatedWebhookEndpoint,
  type WebhookDeliveryList,
  type WebhookEndpointList,
  type WebhookEndpointView,
  type WebhookEventType,
} from "@crmwsp/contracts";
import { redact, type CipherBox } from "@crmwsp/crypto";
import { and, apiKeys, desc, eq, isNull, isUuid, webhookDeliveries, webhookEndpoints, type ApiKey, type WebhookEndpoint } from "@crmwsp/db";
import { API_KEY_PREFIX, WEBHOOK_SECRET_PURPOSE, apiKeyDisplayPrefix, checkWebhookUrl } from "@crmwsp/domain";
import { CurrentTenantDb, Roles } from "../auth/decorators.js";
import { TenantGuard } from "../auth/tenant.guard.js";
import { CIPHER_BOX } from "../channels/channels.constants.js";
import type { HttpRequest } from "../common/http.js";
import { parseOrThrow } from "../common/zod.js";
import type { TenantDb } from "../db/tenant-db.js";
import { writeAudit } from "../inbox/audit.js";
import { hashApiKey } from "./api-key.guard.js";

const MAX_ACTIVE_KEYS = 20;
const MAX_ENDPOINTS = 10;

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

function keyView(k: ApiKey): ApiKeyView {
  return {
    id: k.id,
    name: k.name,
    prefix: k.prefix,
    scopes: k.scopes as ApiKeyScope[],
    lastUsedAt: iso(k.lastUsedAt),
    revokedAt: iso(k.revokedAt),
    createdAt: k.createdAt.toISOString(),
  };
}

function endpointView(e: WebhookEndpoint): WebhookEndpointView {
  return {
    id: e.id,
    url: e.url,
    description: e.description,
    events: e.events as WebhookEventType[],
    status: e.status,
    disabledReason: e.disabledReason,
    consecutiveFailures: e.consecutiveFailures,
    secretHint: e.secretHint,
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
  };
}

/** SSRF guard at registration (the worker re-checks + pins DNS at every delivery). */
export function assertWebhookUrl(url: string): void {
  // Fail closed (CN-011): http:// only with an explicit development/test NODE_ENV.
  const nodeEnv = process.env["NODE_ENV"];
  const r = checkWebhookUrl(url, { allowHttp: nodeEnv === "development" || nodeEnv === "test" });
  if (!r.ok) throw new ValidationError(`Webhook URL rejected (${r.reason})`);
}

@Controller("developers")
@UseGuards(TenantGuard)
export class DevelopersController {
  constructor(@Inject(CIPHER_BOX) private readonly cipher: CipherBox | null) {}

  // ---- API keys ----

  @Get("api-keys")
  @Roles("owner", "admin")
  async listKeys(@CurrentTenantDb() db: TenantDb): Promise<ApiKeyList> {
    const rows = await db.run((tx) => tx.select().from(apiKeys).orderBy(desc(apiKeys.createdAt)));
    return { items: rows.map(keyView) };
  }

  /** Returns the plaintext key ONCE; only its SHA-256 is stored. */
  @Post("api-keys")
  @Roles("owner", "admin")
  async createKey(@CurrentTenantDb() db: TenantDb, @Body() body: unknown, @Req() req: HttpRequest): Promise<CreatedApiKey> {
    const input = parseOrThrow(createApiKeyRequestSchema, body);
    const key = `${API_KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
    const row = await db.run(async (tx) => {
      const active = await tx.select({ id: apiKeys.id }).from(apiKeys).where(isNull(apiKeys.revokedAt));
      if (active.length >= MAX_ACTIVE_KEYS) throw new ValidationError(`At most ${MAX_ACTIVE_KEYS} active API keys`);
      const [saved] = await tx
        .insert(apiKeys)
        .values({
          tenantId: db.tenantId,
          name: input.name,
          prefix: apiKeyDisplayPrefix(key),
          keyHash: hashApiKey(key),
          scopes: [...new Set(input.scopes)],
          createdByUserId: db.userId,
        })
        .returning();
      if (!saved) throw new Error("insert returned no row");
      await writeAudit(tx, {
        tenantId: db.tenantId,
        userId: db.userId,
        entity: "api_key",
        entityId: saved.id,
        action: "api_key.created",
        diff: { name: saved.name, prefix: saved.prefix, scopes: saved.scopes },
        ip: req.ip,
      });
      return saved;
    });
    return { ...keyView(row), key };
  }

  @Delete("api-keys/:id")
  @Roles("owner", "admin")
  @HttpCode(204)
  async revokeKey(@CurrentTenantDb() db: TenantDb, @Param("id") id: string, @Req() req: HttpRequest): Promise<void> {
    if (!isUuid(id)) throw new NotFoundError();
    await db.run(async (tx) => {
      const [row] = await tx
        .update(apiKeys)
        .set({ revokedAt: new Date() })
        .where(and(eq(apiKeys.id, id), isNull(apiKeys.revokedAt)))
        .returning({ id: apiKeys.id, prefix: apiKeys.prefix });
      if (!row) throw new NotFoundError();
      await writeAudit(tx, {
        tenantId: db.tenantId,
        userId: db.userId,
        entity: "api_key",
        entityId: row.id,
        action: "api_key.revoked",
        diff: { prefix: row.prefix },
        ip: req.ip,
      });
    });
  }

  // ---- Outbound webhook endpoints ----

  @Get("webhooks")
  @Roles("owner", "admin")
  async listEndpoints(@CurrentTenantDb() db: TenantDb): Promise<WebhookEndpointList> {
    const rows = await db.run((tx) => tx.select().from(webhookEndpoints).orderBy(desc(webhookEndpoints.createdAt)));
    return { items: rows.map(endpointView) };
  }

  /** Returns the HMAC signing secret ONCE; stored encrypted (tenant-bound AAD). */
  @Post("webhooks")
  @Roles("owner", "admin")
  async createEndpoint(@CurrentTenantDb() db: TenantDb, @Body() body: unknown, @Req() req: HttpRequest): Promise<CreatedWebhookEndpoint> {
    const input = parseOrThrow(createWebhookEndpointRequestSchema, body);
    assertWebhookUrl(input.url);
    if (!this.cipher) throw new EncryptionNotConfiguredError();
    const secret = `whsec_${randomBytes(32).toString("base64url")}`;
    const secretEncrypted = this.cipher.encrypt(secret, { tenantId: db.tenantId, purpose: WEBHOOK_SECRET_PURPOSE });
    const row = await db.run(async (tx) => {
      const existing = await tx.select({ id: webhookEndpoints.id }).from(webhookEndpoints);
      if (existing.length >= MAX_ENDPOINTS) throw new ValidationError(`At most ${MAX_ENDPOINTS} webhook endpoints`);
      const [saved] = await tx
        .insert(webhookEndpoints)
        .values({
          tenantId: db.tenantId,
          url: input.url,
          description: input.description ?? null,
          events: [...new Set(input.events)],
          secretEncrypted,
          secretHint: redact(secret),
        })
        .returning();
      if (!saved) throw new Error("insert returned no row");
      await writeAudit(tx, {
        tenantId: db.tenantId,
        userId: db.userId,
        entity: "webhook_endpoint",
        entityId: saved.id,
        action: "webhook_endpoint.created",
        diff: { url: saved.url, events: saved.events },
        ip: req.ip,
      });
      return saved;
    });
    return { ...endpointView(row), secret };
  }

  @Patch("webhooks/:id")
  @Roles("owner", "admin")
  async updateEndpoint(@CurrentTenantDb() db: TenantDb, @Param("id") id: string, @Body() body: unknown, @Req() req: HttpRequest): Promise<WebhookEndpointView> {
    if (!isUuid(id)) throw new NotFoundError();
    const input = parseOrThrow(updateWebhookEndpointRequestSchema, body);
    if (input.url) assertWebhookUrl(input.url);
    const row = await db.run(async (tx) => {
      const [saved] = await tx
        .update(webhookEndpoints)
        .set({
          ...(input.url ? { url: input.url } : {}),
          ...(input.events ? { events: [...new Set(input.events)] } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.status === "active" ? { status: "active" as const, disabledReason: null, consecutiveFailures: 0 } : {}),
          ...(input.status === "disabled" ? { status: "disabled" as const, disabledReason: "manual" } : {}),
          updatedAt: new Date(),
        })
        .where(eq(webhookEndpoints.id, id))
        .returning();
      if (!saved) throw new NotFoundError();
      await writeAudit(tx, {
        tenantId: db.tenantId,
        userId: db.userId,
        entity: "webhook_endpoint",
        entityId: saved.id,
        action: "webhook_endpoint.updated",
        diff: { url: input.url, events: input.events, status: input.status },
        ip: req.ip,
      });
      return saved;
    });
    return endpointView(row);
  }

  @Delete("webhooks/:id")
  @Roles("owner", "admin")
  @HttpCode(204)
  async deleteEndpoint(@CurrentTenantDb() db: TenantDb, @Param("id") id: string, @Req() req: HttpRequest): Promise<void> {
    if (!isUuid(id)) throw new NotFoundError();
    await db.run(async (tx) => {
      const [row] = await tx.delete(webhookEndpoints).where(eq(webhookEndpoints.id, id)).returning({ id: webhookEndpoints.id, url: webhookEndpoints.url });
      if (!row) throw new NotFoundError();
      await writeAudit(tx, {
        tenantId: db.tenantId,
        userId: db.userId,
        entity: "webhook_endpoint",
        entityId: row.id,
        action: "webhook_endpoint.deleted",
        diff: { url: row.url },
        ip: req.ip,
      });
    });
  }

  @Get("webhooks/:id/deliveries")
  @Roles("owner", "admin")
  async listDeliveries(@CurrentTenantDb() db: TenantDb, @Param("id") id: string): Promise<WebhookDeliveryList> {
    if (!isUuid(id)) throw new NotFoundError();
    const rows = await db.run((tx) =>
      tx.select().from(webhookDeliveries).where(eq(webhookDeliveries.endpointId, id)).orderBy(desc(webhookDeliveries.createdAt)).limit(50),
    );
    return {
      items: rows.map((d) => ({
        id: d.id,
        eventId: d.eventId,
        eventType: d.eventType as WebhookEventType,
        status: d.status,
        attempts: d.attempts,
        lastStatusCode: d.lastStatusCode,
        lastError: d.lastError,
        nextAttemptAt: iso(d.nextAttemptAt),
        deliveredAt: iso(d.deliveredAt),
        createdAt: d.createdAt.toISOString(),
      })),
    };
  }
}
