import { GUPSHUP_PARTNER_TOKEN_PURPOSE } from "@crmwsp/contracts";
import type { CipherBox } from "@crmwsp/crypto";
import { channelConnections, messageTemplates, withTenant, type Database, type Transaction } from "@crmwsp/db";
import type { ProviderTemplate, WhatsAppProvider } from "@crmwsp/whatsapp";
import { eq, sql } from "drizzle-orm";
import type { Logger } from "../processors.js";

/** AAD purpose of the encrypted Gupshup API key (same as outbound.ts / apps/api channels). */
export const TEMPLATE_SYNC_API_KEY_PURPOSE = "gupshup_api_key";

export interface SyncChannel {
  id: string;
  provider: "gupshup" | "360dialog";
  appName: string;
  sourcePhone: string;
  credentials: Buffer;
  /** Gupshup Partner API app id / encrypted app token; null on channels that never configured them. */
  partnerAppId: string | null;
  partnerToken: Buffer | null;
}

export interface LocalTemplate {
  id: string;
  name: string;
  language: string;
  status: string;
  externalId: string | null;
}

export interface TemplateUpdate {
  id: string;
  status: ProviderTemplate["status"];
  externalId: string;
}

export interface TemplateSyncPlan {
  updates: TemplateUpdate[];
  /** Present at the BSP (e.g. created in its console) but unknown locally. */
  inserts: ProviderTemplate[];
}

const keyOf = (name: string, language: string): string => `${name}\u0000${language}`;

/**
 * Pure reconciliation of the BSP listing against local rows, keyed by (name, language).
 * Local rows missing from the listing are left alone (a just-submitted template may lag).
 */
export function planTemplateSync(local: LocalTemplate[], remote: ProviderTemplate[]): TemplateSyncPlan {
  const byKey = new Map(local.map((l) => [keyOf(l.name, l.language), l]));
  const plan: TemplateSyncPlan = { updates: [], inserts: [] };
  for (const r of remote) {
    const l = byKey.get(keyOf(r.name, r.language));
    if (!l) {
      plan.inserts.push(r);
    } else if (l.status !== r.status || l.externalId !== r.externalId) {
      plan.updates.push({ id: l.id, status: r.status, externalId: r.externalId });
    }
  }
  return plan;
}

/** Persistence port of one tenant (Postgres adapter below; in-memory fake in tests). */
export interface TemplateSyncStore {
  loadChannels(): Promise<SyncChannel[]>;
  loadTemplates(channelId: string): Promise<LocalTemplate[]>;
  apply(channelId: string, plan: TemplateSyncPlan, now: Date): Promise<void>;
}

export interface TemplateSyncDeps {
  db: Database;
  cipher: CipherBox;
  provider: Pick<WhatsAppProvider, "listTemplates">;
  logger?: Logger;
  now?: () => Date;
  /** Test seams. */
  listTenants?: () => Promise<string[]>;
  inTenant?: <T>(tenantId: string, fn: (store: TemplateSyncStore) => Promise<T>) => Promise<T>;
}

export interface TemplateSyncTenantResult {
  channels: number;
  updated: number;
  imported: number;
  failedChannels: number;
  /** Channels without Partner API credentials (appId/token): not an error, nothing to sync. */
  skippedChannels: number;
}

const silent: Logger = { info: () => {}, warn: () => {}, error: () => {} };

const storeRunner = (deps: TemplateSyncDeps) =>
  deps.inTenant ??
  (<T>(tenantId: string, fn: (s: TemplateSyncStore) => Promise<T>) => withTenant(deps.db, tenantId, (tx) => fn(createPgTemplateSyncStore(tx, tenantId))));

/**
 * Syncs one tenant. The BSP call runs outside any DB transaction; each channel's result is applied
 * in its own withTenant transaction. A failing channel never stops the others and only its error
 * class is logged (never the key, URL or response).
 */
export async function syncTemplatesTenant(deps: TemplateSyncDeps, tenantId: string): Promise<TemplateSyncTenantResult> {
  const logger = deps.logger ?? silent;
  const inTenant = storeRunner(deps);
  const channels = await inTenant(tenantId, (s) => s.loadChannels());
  const res: TemplateSyncTenantResult = { channels: channels.length, updated: 0, imported: 0, failedChannels: 0, skippedChannels: 0 };
  for (const ch of channels) {
    // Only Gupshup needs Partner API credentials for templates; 360dialog authenticates with the channel key.
    if (ch.provider === "gupshup" && (!ch.partnerAppId || !ch.partnerToken)) {
      res.skippedChannels++;
      logger.info("template sync skipped for a channel: no Gupshup partner credentials (app id/token) configured");
      continue;
    }
    try {
      const apiKey = deps.cipher.decrypt(ch.credentials, { tenantId, purpose: TEMPLATE_SYNC_API_KEY_PURPOSE });
      const partnerToken = ch.partnerToken ? deps.cipher.decrypt(ch.partnerToken, { tenantId, purpose: GUPSHUP_PARTNER_TOKEN_PURPOSE }) : undefined;
      const remote = await deps.provider.listTemplates({
        provider: ch.provider,
        apiKey,
        appName: ch.appName,
        sourcePhone: ch.sourcePhone,
        ...(ch.partnerAppId ? { partnerAppId: ch.partnerAppId } : {}),
        ...(partnerToken ? { partnerToken } : {}),
      });
      const now = deps.now?.() ?? new Date();
      const counts = await inTenant(tenantId, async (s) => {
        const plan = planTemplateSync(await s.loadTemplates(ch.id), remote);
        await s.apply(ch.id, plan, now);
        return { updated: plan.updates.length, imported: plan.inserts.length };
      });
      res.updated += counts.updated;
      res.imported += counts.imported;
    } catch (err) {
      res.failedChannels++;
      logger.warn(`template sync failed for a channel (${err instanceof Error ? err.name : "unknown"})`);
    }
  }
  return res;
}

export interface TemplateTickResult {
  tenants: number;
  updated: number;
  imported: number;
  failedChannels: number;
  skippedChannels: number;
  failedTenants: number;
}

/** Every active tenant, one at a time; a failing tenant never stops the others. */
export async function runTemplateSyncTick(deps: TemplateSyncDeps): Promise<TemplateTickResult> {
  const logger = deps.logger ?? silent;
  const listTenants =
    deps.listTenants ??
    (async () => (await deps.db.execute<{ tenant_id: string }>(sql`select tenant_id from follow_up_tenant_ids()`)).map((r) => r.tenant_id));
  const ids = await listTenants();
  const res: TemplateTickResult = { tenants: ids.length, updated: 0, imported: 0, failedChannels: 0, skippedChannels: 0, failedTenants: 0 };
  for (const tenantId of ids) {
    try {
      const r = await syncTemplatesTenant(deps, tenantId);
      res.updated += r.updated;
      res.imported += r.imported;
      res.failedChannels += r.failedChannels;
      res.skippedChannels += r.skippedChannels;
    } catch (err) {
      res.failedTenants++;
      logger.warn(`template sync failed for a tenant (${err instanceof Error ? err.name : "unknown"})`);
    }
  }
  return res;
}

/** Postgres adapter; `tx` comes from withTenant, so RLS scopes every statement. */
export function createPgTemplateSyncStore(tx: Transaction, tenantId: string): TemplateSyncStore {
  return {
    async loadChannels() {
      const rows = await tx
        .select({
          id: channelConnections.id,
          provider: channelConnections.provider,
          appName: channelConnections.externalAppId,
          sourcePhone: channelConnections.phoneE164,
          credentials: channelConnections.credentialsEncrypted,
          partnerAppId: channelConnections.gupshupAppId,
          partnerToken: channelConnections.partnerTokenEncrypted,
        })
        .from(channelConnections)
        .where(eq(channelConnections.status, "active"));
      const out: SyncChannel[] = [];
      for (const r of rows) if (r.appName && r.credentials) out.push({ id: r.id, provider: r.provider, appName: r.appName, sourcePhone: r.sourcePhone, credentials: r.credentials, partnerAppId: r.partnerAppId, partnerToken: r.partnerToken });
      return out;
    },
    async loadTemplates(channelId) {
      return tx
        .select({
          id: messageTemplates.id,
          name: messageTemplates.name,
          language: messageTemplates.language,
          status: messageTemplates.status,
          externalId: messageTemplates.externalId,
        })
        .from(messageTemplates)
        .where(eq(messageTemplates.channelConnectionId, channelId));
    },
    async apply(channelId, plan, now) {
      for (const u of plan.updates) {
        await tx
          .update(messageTemplates)
          .set({ status: u.status, externalId: u.externalId, syncedAt: now, updatedAt: now })
          .where(eq(messageTemplates.id, u.id));
      }
      if (plan.inserts.length > 0) {
        await tx
          .insert(messageTemplates)
          .values(
            plan.inserts.map((r) => ({
              tenantId,
              channelConnectionId: channelId,
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
    },
  };
}
