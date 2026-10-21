import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Put, Req, UseGuards } from "@nestjs/common";
import {
  ConflictError,
  EncryptionNotConfiguredError,
  AppError,
  ErrorCode,
  NotFoundError,
  ValidationError,
  upsertCommerceConnectionRequestSchema,
  type CatalogSyncResult,
  type CommerceConnectionList,
  type CommerceConnectionView,
} from "@crmwsp/contracts";
import { redact, type CipherBox } from "@crmwsp/crypto";
import { and, commerceConnections, eq, type CommerceConnection } from "@crmwsp/db";
import { connectorFor, isCatalogProvider, type CommerceProvider, type FetchLike } from "@crmwsp/integrations";
import { generateWebhookToken } from "@crmwsp/whatsapp";
import { CurrentTenantDb, Roles } from "../auth/decorators.js";
import { TenantGuard } from "../auth/tenant.guard.js";
import { CIPHER_BOX } from "../channels/channels.constants.js";
import type { HttpRequest } from "../common/http.js";
import { parseOrThrow } from "../common/zod.js";
import type { TenantDb } from "../db/tenant-db.js";
import { writeAudit } from "../inbox/audit.js";
import { isCommerceProvider } from "./commerce-webhook.service.js";
import { COMMERCE_FETCH, commerceAccessTokenPurpose, commerceWebhookSecretPurpose, commerceWebhookUrlFor } from "./integrations.constants.js";
import { resolveStoreCredentials } from "./store-credentials.js";
import { PgCommerceTx } from "./pg-commerce-ledger.js";

function toView(row: CommerceConnection): CommerceConnectionView {
  return {
    provider: row.provider,
    status: row.status,
    secretHint: row.secretHint,
    shopDomain: row.shopDomain,
    hasAccessToken: row.accessTokenEncrypted !== null,
    weakAuth: connectorFor(row.provider).weakAuth === true,
    webhookUrl: commerceWebhookUrlFor(row.provider, row.webhookToken),
    lastSyncedAt: row.lastSyncedAt ? row.lastSyncedAt.toISOString() : null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function providerOrNotFound(p: string): CommerceProvider {
  if (!isCommerceProvider(p)) throw new NotFoundError();
  return p;
}

@Controller("integrations/commerce")
@UseGuards(TenantGuard)
export class IntegrationsController {
  constructor(
    @Inject(CIPHER_BOX) private readonly cipher: CipherBox | null,
    @Inject(COMMERCE_FETCH) private readonly fetchImpl: FetchLike,
  ) {}

  @Get()
  @Roles("owner", "admin")
  async list(@CurrentTenantDb() db: TenantDb): Promise<CommerceConnectionList> {
    const rows = await db.run((tx) => tx.select().from(commerceConnections));
    return { items: rows.map(toView) };
  }

  /** BYOK: stores the provider secret (and Shopify access token) encrypted, tenant-bound AAD. */
  @Put(":provider")
  @Roles("owner", "admin")
  async upsert(@CurrentTenantDb() db: TenantDb, @Param("provider") p: string, @Body() body: unknown, @Req() req: HttpRequest): Promise<CommerceConnectionView> {
    const provider = providerOrNotFound(p);
    const input = parseOrThrow(upsertCommerceConnectionRequestSchema, body);
    if (!this.cipher) throw new EncryptionNotConfiguredError();
    const creds = resolveStoreCredentials(provider, input);
    const webhookSecretEncrypted = this.cipher.encrypt(input.webhookSecret, { tenantId: db.tenantId, purpose: commerceWebhookSecretPurpose(provider) });
    const accessTokenEncrypted = creds.accessToken
      ? this.cipher.encrypt(creds.accessToken, { tenantId: db.tenantId, purpose: commerceAccessTokenPurpose(provider) })
      : undefined;
    const hint = redact(input.webhookSecret);
    const row = await db.run(async (tx) => {
      const now = new Date();
      const [saved] = await tx
        .insert(commerceConnections)
        .values({
          tenantId: db.tenantId,
          provider,
          webhookSecretEncrypted,
          accessTokenEncrypted: accessTokenEncrypted ?? null,
          secretHint: hint,
          shopDomain: creds.shopDomain ?? null,
          webhookToken: generateWebhookToken(),
          status: "active",
        })
        .onConflictDoUpdate({
          target: [commerceConnections.tenantId, commerceConnections.provider],
          // The webhook token is kept: rotating secrets must not break the configured URL.
          set: {
            webhookSecretEncrypted,
            ...(accessTokenEncrypted ? { accessTokenEncrypted } : {}),
            ...(creds.shopDomain ? { shopDomain: creds.shopDomain } : {}),
            secretHint: hint,
            status: "active",
            updatedAt: now,
          },
        })
        .returning();
      if (!saved) throw new Error("upsert returned no row");
      await writeAudit(tx, {
        tenantId: db.tenantId,
        userId: db.userId,
        entity: "commerce_connection",
        entityId: saved.id,
        action: "commerce_connection.saved",
        diff: { provider, secretHint: hint, shopDomain: saved.shopDomain, accessTokenChanged: !!accessTokenEncrypted },
        ip: req.ip,
      });
      return saved;
    });
    return toView(row);
  }

  /** Disables the connection: its webhook URL stops resolving (401). Rows are kept for audit. */
  @Delete(":provider")
  @Roles("owner", "admin")
  @HttpCode(204)
  async disable(@CurrentTenantDb() db: TenantDb, @Param("provider") p: string, @Req() req: HttpRequest): Promise<void> {
    const provider = providerOrNotFound(p);
    await db.run(async (tx) => {
      const [row] = await tx
        .update(commerceConnections)
        .set({ status: "disabled", updatedAt: new Date() })
        .where(eq(commerceConnections.provider, provider))
        .returning({ id: commerceConnections.id });
      if (!row) throw new NotFoundError();
      await writeAudit(tx, {
        tenantId: db.tenantId,
        userId: db.userId,
        entity: "commerce_connection",
        entityId: row.id,
        action: "commerce_connection.disabled",
        diff: { provider },
        ip: req.ip,
      });
    });
  }

  /** Pulls a store catalog (Shopify, Tiendanube, WooCommerce) into products/variants, idempotent by external id. */
  @Post(":provider/sync")
  @Roles("owner", "admin")
  async syncCatalog(@CurrentTenantDb() db: TenantDb, @Param("provider") p: string, @Req() req: HttpRequest): Promise<CatalogSyncResult> {
    const provider = providerOrNotFound(p);
    if (!isCatalogProvider(provider)) throw new NotFoundError();
    if (!this.cipher) throw new EncryptionNotConfiguredError();
    const [conn] = await db.run((tx) =>
      tx
        .select()
        .from(commerceConnections)
        .where(and(eq(commerceConnections.provider, provider), eq(commerceConnections.status, "active"))),
    );
    if (!conn) throw new ConflictError(`${provider} is not connected`);
    if (!conn.accessTokenEncrypted || !conn.shopDomain) throw new ConflictError("Add the store locator and API credentials first");
    const accessToken = this.cipher.decrypt(conn.accessTokenEncrypted, { tenantId: db.tenantId, purpose: commerceAccessTokenPurpose(provider) });
    const listProducts = connectorFor(provider).listProducts;
    if (!listProducts) throw new Error(`${provider} connector without catalog`);

    // Network calls outside any DB transaction.
    let page;
    try {
      page = await listProducts({ shopDomain: conn.shopDomain, accessToken }, this.fetchImpl);
    } catch (err) {
      throw new AppError(ErrorCode.ExternalProvider, `${provider} catalog pull failed (${err instanceof Error ? err.message : "unknown"})`, 502);
    }
    const syncedAt = new Date();
    const counts = await db.run(async (tx) => {
      const out = await new PgCommerceTx(tx, db.tenantId).upsertCatalog(provider, page.currency, page.products);
      await tx
        .update(commerceConnections)
        .set({ lastSyncedAt: syncedAt, shopCurrency: page.currency, updatedAt: syncedAt })
        .where(eq(commerceConnections.id, conn.id));
      await writeAudit(tx, {
        tenantId: db.tenantId,
        userId: db.userId,
        entity: "commerce_connection",
        entityId: conn.id,
        action: "commerce_connection.catalog_synced",
        diff: { provider, ...out, currency: page.currency },
        ip: req.ip,
      });
      return out;
    });
    return { ...counts, currency: page.currency, syncedAt: syncedAt.toISOString() };
  }
}
