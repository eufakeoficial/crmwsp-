import { Body, Controller, Delete, Get, HttpCode, Inject, Put, Req, UseGuards } from "@nestjs/common";
import {
  EncryptionNotConfiguredError,
  META_CAPI_TOKEN_PURPOSE,
  NotFoundError,
  ValidationError,
  upsertAdSpendRequestSchema,
  upsertMetaCapiRequestSchema,
  type AdReport,
  type MetaCapiState,
} from "@crmwsp/contracts";
import { redact, type CipherBox } from "@crmwsp/crypto";
import { adSpend, capiEvents, eq, metaCapiConnections, sql } from "@crmwsp/db";
import { CurrentTenantDb, Roles } from "../auth/decorators.js";
import { TenantGuard } from "../auth/tenant.guard.js";
import { CIPHER_BOX } from "../channels/channels.constants.js";
import type { HttpRequest } from "../common/http.js";
import { parseOrThrow } from "../common/zod.js";
import type { TenantDb } from "../db/tenant-db.js";
import { writeAudit } from "../inbox/audit.js";
import { adReport } from "./ads.queries.js";

@Controller("ads")
@UseGuards(TenantGuard)
export class AdsController {
  /** Per ad id: conversations, orders, verified paid revenue, manual spend and ROAS. */
  @Get("report")
  @Roles("owner", "admin")
  async report(@CurrentTenantDb() db: TenantDb): Promise<AdReport> {
    return { items: await db.run((tx) => adReport(tx)) };
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
