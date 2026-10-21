import { Body, Controller, Delete, Get, HttpCode, Inject, Optional, Post, Put, Query, Req, UseGuards } from "@nestjs/common";
import type { Queue } from "bullmq";
import {
  EncryptionNotConfiguredError,
  META_ADS_SYNC_TENANT_JOB,
  META_ADS_TOKEN_PURPOSE,
  META_CAPI_TOKEN_PURPOSE,
  NotFoundError,
  ValidationError,
  adRecommendationSettingsSchema,
  adReportQuerySchema,
  listMetaAdAccountsRequestSchema,
  upsertAdSpendRequestSchema,
  upsertMetaAdsRequestSchema,
  upsertMetaCapiRequestSchema,
  type AdRecommendationSettings,
  type AdReport,
  type MetaAdAccounts,
  type MetaAdsState,
  type MetaCapiState,
} from "@crmwsp/contracts";
import { redact, type CipherBox } from "@crmwsp/crypto";
import { adSpend, capiEvents, eq, metaAdsConnections, metaCapiConnections, sql } from "@crmwsp/db";
import { CurrentTenantDb, Roles } from "../auth/decorators.js";
import { TenantGuard } from "../auth/tenant.guard.js";
import { CIPHER_BOX } from "../channels/channels.constants.js";
import type { HttpRequest } from "../common/http.js";
import { parseOrThrow } from "../common/zod.js";
import type { TenantDb } from "../db/tenant-db.js";
import { writeAudit } from "../inbox/audit.js";
import { adReport, loadThresholds } from "./ads.queries.js";
import { META_ADS_FETCH, META_ADS_QUEUE } from "./ads.constants.js";
import { listMetaAdAccounts, type MetaGetFetch } from "./meta-ads.client.js";

@Controller("ads")
@UseGuards(TenantGuard)
export class AdsController {
  /**
   * Per campaign / adset / ad for [from, to]: conversations, orders, verified paid revenue, spend
   * (daily Meta sync, manual fallback), ROAS, cost per conversation / purchase and an advisory
   * recommendation.
   */
  @Get("report")
  @Roles("owner", "admin")
  async report(@CurrentTenantDb() db: TenantDb, @Query() query: unknown): Promise<AdReport> {
    const q = parseOrThrow(adReportQuerySchema, query);
    return db.run((tx) => adReport(tx, db.tenantId, q));
  }

  /** Recommendation thresholds (stored with the Meta Ads connection). */
  @Put("settings")
  @Roles("owner", "admin")
  @HttpCode(204)
  async saveSettings(@CurrentTenantDb() db: TenantDb, @Body() body: unknown, @Req() req: HttpRequest): Promise<void> {
    const input = parseOrThrow(adRecommendationSettingsSchema, body);
    await db.run(async (tx) => {
      const [row] = await tx
        .update(metaAdsConnections)
        .set({
          targetRoasBp: Math.round(input.targetRoas * 100),
          breakEvenRoasBp: Math.round(input.breakEvenRoas * 100),
          minSpendMinor: input.minSpendMinor,
          minConversations: input.minConversations,
          pauseSpendMinor: input.pauseSpendMinor,
          updatedAt: new Date(),
        })
        .returning({ id: metaAdsConnections.id });
      if (!row) throw new ValidationError("Connect a Meta ad account first");
      await writeAudit(tx, {
        tenantId: db.tenantId,
        userId: db.userId,
        entity: "meta_ads_connection",
        entityId: row.id,
        action: "ads_settings.saved",
        diff: { ...input },
        ip: req.ip,
      });
    });
  }

  /** Manual ad spend (total per ad id and currency). Upsert; 0 clears it. */
  @Put("spend")
  @Roles("owner", "admin")
  @HttpCode(204)
  async upsertSpend(@CurrentTenantDb() db: TenantDb, @Body() body: unknown, @Req() req: HttpRequest): Promise<void> {
    const input = parseOrThrow(upsertAdSpendRequestSchema, body);
    await db.run(async (tx) => {
      const now = new Date();
      const [row] = await tx
        .insert(adSpend)
        .values({ tenantId: db.tenantId, sourceId: input.sourceId, currency: input.currency, amountMinor: BigInt(input.amountMinor), label: input.label ?? null })
        .onConflictDoUpdate({
          target: [adSpend.tenantId, adSpend.sourceId, adSpend.currency],
          set: { amountMinor: BigInt(input.amountMinor), ...(input.label !== undefined ? { label: input.label } : {}), updatedAt: now },
        })
        .returning({ id: adSpend.id });
      if (!row) throw new Error("upsert returned no row");
      await writeAudit(tx, {
        tenantId: db.tenantId,
        userId: db.userId,
        entity: "ad_spend",
        entityId: row.id,
        action: "ad_spend.saved",
        diff: { sourceId: input.sourceId, currency: input.currency, amountMinor: input.amountMinor },
        ip: req.ip,
      });
    });
  }
}

@Controller("integrations/meta-capi")
@UseGuards(TenantGuard)
export class MetaCapiController {
  constructor(@Inject(CIPHER_BOX) private readonly cipher: CipherBox | null) {}

  @Get()
  @Roles("owner", "admin")
  async get(@CurrentTenantDb() db: TenantDb): Promise<MetaCapiState> {
    return db.run(async (tx) => {
      const [c] = await tx.select().from(metaCapiConnections).limit(1);
      if (!c) return { connection: null };
      const counts = await tx
        .select({ status: capiEvents.status, n: sql<number>`count(*)::int` })
        .from(capiEvents)
        .groupBy(capiEvents.status);
      const n = (s: string) => counts.find((r) => r.status === s)?.n ?? 0;
      return {
        connection: {
          datasetId: c.datasetId,
          status: c.status,
          tokenHint: c.tokenHint,
          testEventCode: c.testEventCode,
          updatedAt: c.updatedAt.toISOString(),
          sent: n("sent"),
          pending: n("pending"),
          dead: n("dead"),
        },
      };
    });
  }

  /** BYOK: the access token is stored encrypted (tenant-bound AAD) and never returned. */
  @Put()
  @Roles("owner", "admin")
  @HttpCode(204)
  async upsert(@CurrentTenantDb() db: TenantDb, @Body() body: unknown, @Req() req: HttpRequest): Promise<void> {
    const input = parseOrThrow(upsertMetaCapiRequestSchema, body);
    if (!this.cipher) throw new EncryptionNotConfiguredError();
    const encrypted = input.accessToken ? this.cipher.encrypt(input.accessToken, { tenantId: db.tenantId, purpose: META_CAPI_TOKEN_PURPOSE }) : null;
    const hint = input.accessToken ? redact(input.accessToken) : undefined;
    await db.run(async (tx) => {
      const [existing] = await tx.select({ id: metaCapiConnections.id }).from(metaCapiConnections).limit(1);
      if (!existing && !encrypted) throw new ValidationError("The access token is required");
      const now = new Date();
      const testEventCode = input.testEventCode === undefined ? undefined : input.testEventCode || null;
      const [row] = existing
        ? await tx
            .update(metaCapiConnections)
            .set({
              datasetId: input.datasetId,
              ...(encrypted ? { accessTokenEncrypted: encrypted, tokenHint: hint } : {}),
              ...(testEventCode !== undefined ? { testEventCode } : {}),
              status: "active",
              updatedAt: now,
            })
            .where(eq(metaCapiConnections.id, existing.id))
            .returning({ id: metaCapiConnections.id })
        : await tx
            .insert(metaCapiConnections)
            .values({ tenantId: db.tenantId, datasetId: input.datasetId, accessTokenEncrypted: encrypted as Buffer, tokenHint: hint ?? null, testEventCode: testEventCode ?? null })
            .returning({ id: metaCapiConnections.id });
      if (!row) throw new Error("upsert returned no row");
      await writeAudit(tx, {
        tenantId: db.tenantId,
        userId: db.userId,
        entity: "meta_capi_connection",
        entityId: row.id,
        action: "meta_capi_connection.saved",
        diff: { datasetId: input.datasetId, tokenChanged: !!encrypted, testMode: !!testEventCode },
        ip: req.ip,
      });
    });
  }

  @Delete()
  @Roles("owner", "admin")
  @HttpCode(204)
  async disable(@CurrentTenantDb() db: TenantDb, @Req() req: HttpRequest): Promise<void> {
    await db.run(async (tx) => {
      const [row] = await tx
        .update(metaCapiConnections)
        .set({ status: "disabled", updatedAt: new Date() })
        .returning({ id: metaCapiConnections.id });
      if (!row) throw new NotFoundError();
      await writeAudit(tx, {
        tenantId: db.tenantId,
        userId: db.userId,
        entity: "meta_capi_connection",
        entityId: row.id,
        action: "meta_capi_connection.disabled",
        diff: {},
        ip: req.ip,
      });
    });
  }
}

const toSettings = (t: { targetRoasBp: number; breakEvenRoasBp: number; minSpendMinor: number; minConversations: number; pauseSpendMinor: number }): AdRecommendationSettings => ({
  targetRoas: t.targetRoasBp / 100,
  breakEvenRoas: t.breakEvenRoasBp / 100,
  minSpendMinor: t.minSpendMinor,
  minConversations: t.minConversations,
  pauseSpendMinor: t.pauseSpendMinor,
});

/** Meta Marketing API (ads_read) connection for the automatic spend sync. Read-only towards Meta. */
@Controller("integrations/meta-ads")
@UseGuards(TenantGuard)
export class MetaAdsController {
  constructor(
    @Inject(CIPHER_BOX) private readonly cipher: CipherBox | null,
    @Inject(META_ADS_FETCH) private readonly fetchImpl: MetaGetFetch,
    @Optional() @Inject(META_ADS_QUEUE) private readonly queue?: Pick<Queue, "add">,
  ) {}

  @Get()
  @Roles("owner", "admin")
  async get(@CurrentTenantDb() db: TenantDb): Promise<MetaAdsState> {
    return db.run(async (tx) => {
      const [c] = await tx.select().from(metaAdsConnections).limit(1);
      const settings = toSettings(await loadThresholds(tx));
      if (!c) return { connection: null, settings };
      return {
        connection: {
          adAccountId: c.adAccountId,
          adAccountName: c.adAccountName,
          currency: c.currency?.trim() ?? null,
          status: c.status,
          tokenHint: c.tokenHint,
          lastSyncAt: c.lastSyncAt?.toISOString() ?? null,
          lastSyncStatus: c.lastSyncStatus,
          lastSyncError: c.lastSyncError,
          updatedAt: c.updatedAt.toISOString(),
        },
        settings,
      };
    });
  }

  /** Lists the ad accounts readable with the pasted token (or the stored one). Nothing is stored. */
  @Post("ad-accounts")
  @Roles("owner", "admin")
  @HttpCode(200)
  async adAccounts(@CurrentTenantDb() db: TenantDb, @Body() body: unknown): Promise<MetaAdAccounts> {
    const input = parseOrThrow(listMetaAdAccountsRequestSchema, body ?? {});
    const token = input.accessToken ?? (await this.storedToken(db));
    return { items: await listMetaAdAccounts(this.fetchImpl, token) };
  }

  /** BYOK: the token is stored encrypted (tenant-bound AAD) and never returned. Queues a first sync. */
  @Put()
  @Roles("owner", "admin")
  @HttpCode(204)
  async upsert(@CurrentTenantDb() db: TenantDb, @Body() body: unknown, @Req() req: HttpRequest): Promise<void> {
    const input = parseOrThrow(upsertMetaAdsRequestSchema, body);
    if (!this.cipher) throw new EncryptionNotConfiguredError();
    const encrypted = input.accessToken ? this.cipher.encrypt(input.accessToken, { tenantId: db.tenantId, purpose: META_ADS_TOKEN_PURPOSE }) : null;
    const hint = input.accessToken ? redact(input.accessToken) : undefined;
    await db.run(async (tx) => {
      const [existing] = await tx.select({ id: metaAdsConnections.id, adAccountId: metaAdsConnections.adAccountId }).from(metaAdsConnections).limit(1);
      if (!existing && !encrypted) throw new ValidationError("The access token is required");
      const now = new Date();
      const common = {
        adAccountId: input.adAccountId,
        ...(input.adAccountName !== undefined ? { adAccountName: input.adAccountName } : {}),
        ...(input.currency !== undefined ? { currency: input.currency } : {}),
      };
      const [row] = existing
        ? await tx
            .update(metaAdsConnections)
            .set({
              ...common,
              ...(encrypted ? { accessTokenEncrypted: encrypted, tokenHint: hint } : {}),
              ...(existing.adAccountId !== input.adAccountId ? { lastSyncAt: null, lastSyncStatus: null, lastSyncError: null } : {}),
              status: "active",
              updatedAt: now,
            })
            .where(eq(metaAdsConnections.id, existing.id))
            .returning({ id: metaAdsConnections.id })
        : await tx
            .insert(metaAdsConnections)
            .values({ tenantId: db.tenantId, ...common, accessTokenEncrypted: encrypted as Buffer, tokenHint: hint ?? null })
            .returning({ id: metaAdsConnections.id });
      if (!row) throw new Error("upsert returned no row");
      await writeAudit(tx, {
        tenantId: db.tenantId,
        userId: db.userId,
        entity: "meta_ads_connection",
        entityId: row.id,
        action: "meta_ads_connection.saved",
        diff: { adAccountId: input.adAccountId, tokenChanged: !!encrypted },
        ip: req.ip,
      });
    });
    await this.enqueue(db.tenantId);
  }

  /** "Sincronizar ahora": queues one sync for this tenant (deduplicated while one is waiting). */
  @Post("sync")
  @Roles("owner", "admin")
  @HttpCode(202)
  async syncNow(@CurrentTenantDb() db: TenantDb): Promise<{ queued: boolean }> {
    const active = await db.run(async (tx) => {
      const [c] = await tx.select({ status: metaAdsConnections.status }).from(metaAdsConnections).limit(1);
      return c?.status === "active";
    });
    if (!active) throw new NotFoundError();
    return { queued: await this.enqueue(db.tenantId) };
  }

  @Delete()
  @Roles("owner", "admin")
  @HttpCode(204)
  async disable(@CurrentTenantDb() db: TenantDb, @Req() req: HttpRequest): Promise<void> {
    await db.run(async (tx) => {
      const [row] = await tx.update(metaAdsConnections).set({ status: "disabled", updatedAt: new Date() }).returning({ id: metaAdsConnections.id });
      if (!row) throw new NotFoundError();
      await writeAudit(tx, {
        tenantId: db.tenantId,
        userId: db.userId,
        entity: "meta_ads_connection",
        entityId: row.id,
        action: "meta_ads_connection.disabled",
        diff: {},
        ip: req.ip,
      });
    });
  }

  private async storedToken(db: TenantDb): Promise<string> {
    if (!this.cipher) throw new EncryptionNotConfiguredError();
    const cipher = this.cipher;
    const enc = await db.run(async (tx) => (await tx.select({ token: metaAdsConnections.accessTokenEncrypted }).from(metaAdsConnections).limit(1))[0]?.token);
    if (!enc) throw new ValidationError("The access token is required");
    return cipher.decrypt(enc, { tenantId: db.tenantId, purpose: META_ADS_TOKEN_PURPOSE });
  }

  private async enqueue(tenantId: string): Promise<boolean> {
    if (!this.queue) return false;
    try {
      // BullMQ job ids must not contain ":"; a waiting job for the tenant dedupes repeated clicks.
      await this.queue.add(META_ADS_SYNC_TENANT_JOB, { tenantId }, { jobId: `meta-ads-sync-${tenantId}`, removeOnComplete: true, removeOnFail: { count: 50 } });
      return true;
    } catch {
      return false;
    }
  }
}
