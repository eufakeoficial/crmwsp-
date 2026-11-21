import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Put, Req, UseGuards } from "@nestjs/common";
import {
  ConflictError,
  EncryptionNotConfiguredError,
  AppError,
  ErrorCode,
  NotFoundError,
  upsertCommerceConnectionRequestSchema,
  type CatalogSyncResult,
  type CommerceConnectionList,
  type CommerceConnectionView,
  type WooConnectCodeResponse,
} from "@crmwsp/contracts";
import type { CipherBox } from "@crmwsp/crypto";
import { and, commerceConnections, eq, type CommerceConnection } from "@crmwsp/db";
import { connectorFor, isCatalogProvider, type CommerceProvider, type FetchLike } from "@crmwsp/integrations";
import { CurrentTenantDb, Roles } from "../auth/decorators.js";
import { TenantGuard } from "../auth/tenant.guard.js";
import { CIPHER_BOX } from "../channels/channels.constants.js";
import type { HttpRequest } from "../common/http.js";
import { parseOrThrow } from "../common/zod.js";
import type { TenantDb } from "../db/tenant-db.js";
import { writeAudit } from "../inbox/audit.js";
import { isCommerceProvider } from "./commerce-webhook.service.js";
import { upsertCommerceConnection } from "./commerce-connection.upsert.js";
import { CONNECT_CODE_TTL_SECONDS, formatConnectCode, generateConnectCode, hashConnectCode } from "./connect-code.js";
import { CONNECT_CODE_REPOSITORY, type ConnectCodeRepository } from "./connect-code.repository.js";
import { COMMERCE_FETCH, commerceAccessTokenPurpose, commerceWebhookUrlFor } from "./integrations.constants.js";
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
    @Inject(CONNECT_CODE_REPOSITORY) private readonly connectCodes: ConnectCodeRepository,
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
    const row = await db.run((tx) =>
      upsertCommerceConnection(tx, this.cipher, { tenantId: db.tenantId, userId: db.userId, provider, input, ip: req.ip }),
    );
    return toView(row);
  }

  /**
   * Issues a single-use WooCommerce connect code (15 min) for the WordPress plugin. Only its SHA-256
   * is stored; issuing a new one voids the previous unused code.
   */
  @Post("woocommerce/connect-code")
  @Roles("owner", "admin")
  async issueWooConnectCode(@CurrentTenantDb() db: TenantDb, @Req() req: HttpRequest): Promise<WooConnectCodeResponse> {
    const code = generateConnectCode();
    const expiresAt = await db.run(async (tx) => {
      const exp = await this.connectCodes.issue(tx, db.tenantId, db.userId, hashConnectCode(code), CONNECT_CODE_TTL_SECONDS);
      if (!exp) throw new ConflictError("The workspace cannot connect stores right now");
      await writeAudit(tx, {
        tenantId: db.tenantId,
        userId: db.userId,
        entity: "commerce_connection",
        entityId: db.tenantId,
        action: "commerce_connection.connect_code_issued",
        diff: { provider: "woocommerce", expiresAt: exp.toISOString() },
        ip: req.ip,
      });
      return exp;
    });
    return { code: formatConnectCode(code), expiresAt: expiresAt.toISOString() };
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
