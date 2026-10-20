import { META_CAPI_TOKEN_PURPOSE } from "@crmwsp/contracts";
import type { CipherBox } from "@crmwsp/crypto";
import { capiEvents, contacts, metaCapiConnections, orders, adAttributions, withTenant, type Database, type Transaction } from "@crmwsp/db";
import { CAPI_MAX_ATTEMPTS, CAPI_MAX_EVENT_AGE_MS, capiRetryDelayMs, isRetryableCapiStatus } from "@crmwsp/domain";
import { and, eq, inArray, lte, sql } from "drizzle-orm";
import type { Logger } from "../processors.js";
import { sendCapiEvent, type CapiDestination, type CapiOutgoingEvent, type CapiSendResult, type FetchLike } from "./client.js";

export const CAPI_BATCH_PER_TENANT = 50;
/** Rows being sent are hidden from other ticks for this long. */
export const CAPI_LEASE_MS = 5 * 60_000;

/** One due event, joined with what the request needs. */
export interface DueCapiEvent extends CapiOutgoingEvent {
  rowId: string;
  attempts: number;
}

export interface CapiOutcome {
  rowId: string;
  attempts: number;
  result: CapiSendResult;
}

/** Persistence port of one tenant (Postgres adapter below; in-memory fake in tests). */
export interface CapiStore {
  /** Creates (idempotently, by event_id) Lead / Purchase rows for new candidates. Returns how many. */
  enqueueCandidates(now: Date): Promise<number>;
  loadDestination(): Promise<{ datasetId: string; accessTokenEncrypted: Buffer; testEventCode: string | null } | null>;
  loadDue(now: Date, limit: number): Promise<DueCapiEvent[]>;
  applyOutcomes(outcomes: CapiOutcome[], now: Date): Promise<void>;
}

export interface CapiTickDeps {
  db: Database;
  cipher: CipherBox;
  fetch: FetchLike;
  logger?: Logger;
  now?: () => Date;
  /** Test seam: tenant ids and store factory. */
  listTenants?: () => Promise<string[]>;
  inTenant?: <T>(tenantId: string, fn: (store: CapiStore) => Promise<T>) => Promise<T>;
}

export interface CapiTickResult {
  tenants: number;
  created: number;
  sent: number;
  failed: number;
  failedTenants: number;
}

const silent: Logger = { info: () => {}, warn: () => {}, error: () => {} };

/** Decides the row update for one send result. */
export function nextState(attempts: number, result: CapiSendResult, now: Date) {
  const n = attempts + 1;
  if (result.ok) return { status: "sent" as const, attempts: n, sentAt: now, lastError: null, nextAttemptAt: now };
  const retry = isRetryableCapiStatus(result.status) && n < CAPI_MAX_ATTEMPTS;
  return {
    status: retry ? ("pending" as const) : ("dead" as const),
    attempts: n,
    sentAt: null,
    lastError: result.error.slice(0, 200),
    nextAttemptAt: new Date(now.getTime() + capiRetryDelayMs(n)),
  };
}

/**
 * One pass: per tenant with an active Meta connection, (1) create missing Lead / Purchase rows in
 * the sent-events log, (2) send the due ones OUTSIDE the transaction, (3) record outcomes. The
 * unique (tenant, event_id) makes creation idempotent; status `sent` is final, so a replayed tick
 * never resends. A crash between send and record resends at most once, and Meta dedupes by
 * event_id.
 */
export async function runCapiTick(deps: CapiTickDeps): Promise<CapiTickResult> {
  const logger = deps.logger ?? silent;
  const listTenants =
    deps.listTenants ??
    (async () => (await deps.db.execute<{ tenant_id: string }>(sql`select tenant_id from capi_tenant_ids()`)).map((r) => r.tenant_id));
  const inTenant = deps.inTenant ?? (<T>(tenantId: string, fn: (s: CapiStore) => Promise<T>) => withTenant(deps.db, tenantId, (tx) => fn(createPgCapiStore(tx, tenantId))));
  const ids = await listTenants();
  const res: CapiTickResult = { tenants: ids.length, created: 0, sent: 0, failed: 0, failedTenants: 0 };
  for (const tenantId of ids) {
    try {
      const now = deps.now?.() ?? new Date();
      const prepared = await inTenant(tenantId, async (store) => {
        res.created += await store.enqueueCandidates(now);
        const dest = await store.loadDestination();
        if (!dest) return null;
        const due = await store.loadDue(now, CAPI_BATCH_PER_TENANT);
        return { dest, due };
      });
      if (!prepared || prepared.due.length === 0) continue;
      const destination: CapiDestination = {
        datasetId: prepared.dest.datasetId,
        accessToken: deps.cipher.decrypt(prepared.dest.accessTokenEncrypted, { tenantId, purpose: META_CAPI_TOKEN_PURPOSE }),
        testEventCode: prepared.dest.testEventCode,
      };
      const outcomes: CapiOutcome[] = [];
      for (const ev of prepared.due) {
        const result = await sendCapiEvent(deps.fetch, destination, ev);
        if (result.ok) res.sent++;
        else res.failed++;
        outcomes.push({ rowId: ev.rowId, attempts: ev.attempts, result });
      }
      const doneAt = deps.now?.() ?? new Date();
      await inTenant(tenantId, (store) => store.applyOutcomes(outcomes, doneAt));
    } catch (err) {
      res.failedTenants++;
      logger.warn(`capi tick failed for a tenant (${err instanceof Error ? err.name : "unknown"})`);
    }
  }
  return res;
}

/** Postgres adapter; `tx` comes from withTenant, so RLS scopes every statement. */
export function createPgCapiStore(tx: Transaction, tenantId: string): CapiStore {
  return {
    async enqueueCandidates(now) {
      const since = new Date(now.getTime() - CAPI_MAX_EVENT_AGE_MS).toISOString();
      // Lead: the first inbound from an ad-attributed contact (click id required for matching).
      const leads = await tx.execute(sql`
        insert into capi_events (tenant_id, event_id, event_name, contact_id, event_time)
        select a.tenant_id, 'lead:' || a.id::text, 'Lead', a.contact_id, a.first_seen_at
        from ad_attributions a
        where a.tenant_id = ${tenantId} and a.ctwa_clid is not null and a.first_seen_at > ${since}::timestamptz
        on conflict (tenant_id, event_id) do nothing
        returning id`);
      // Purchase: order paid AND backed by a payment verified by webhook | reconciliation.
      const purchases = await tx.execute(sql`
        insert into capi_events (tenant_id, event_id, event_name, contact_id, order_id, event_time)
        select o.tenant_id, 'purchase:' || o.id::text, 'Purchase', o.contact_id, o.id, o.paid_at
        from orders o
        join ad_attributions a on a.tenant_id = o.tenant_id and a.contact_id = o.contact_id and a.ctwa_clid is not null
        where o.tenant_id = ${tenantId}
          and o.paid_at is not null and o.paid_at > ${since}::timestamptz
          and o.status in ('paid', 'fulfilled', 'shipped', 'delivered')
          and exists (
            select 1 from payments p
            where p.tenant_id = o.tenant_id and p.order_id = o.id and p.status = 'succeeded'
              and p.verified_by in ('webhook', 'reconciliation'))
        on conflict (tenant_id, event_id) do nothing
        returning id`);
      return leads.length + purchases.length;
    },
    async loadDestination() {
      const [c] = await tx
        .select({ datasetId: metaCapiConnections.datasetId, token: metaCapiConnections.accessTokenEncrypted, testEventCode: metaCapiConnections.testEventCode })
        .from(metaCapiConnections)
        .where(eq(metaCapiConnections.status, "active"))
        .limit(1);
      return c ? { datasetId: c.datasetId, accessTokenEncrypted: c.token, testEventCode: c.testEventCode } : null;
    },
    async loadDue(now, limit) {
      const rows = await tx
        .select({
          rowId: capiEvents.id,
          eventId: capiEvents.eventId,
          eventName: capiEvents.eventName,
          eventTime: capiEvents.eventTime,
          attempts: capiEvents.attempts,
          phoneE164: contacts.phoneE164,
          ctwaClid: adAttributions.ctwaClid,
          totalMinor: orders.totalMinor,
          currency: orders.currency,
        })
        .from(capiEvents)
        .innerJoin(contacts, eq(contacts.id, capiEvents.contactId))
        .leftJoin(adAttributions, eq(adAttributions.contactId, capiEvents.contactId))
        .leftJoin(orders, eq(orders.id, capiEvents.orderId))
        .where(and(eq(capiEvents.status, "pending"), lte(capiEvents.nextAttemptAt, now)))
        .orderBy(capiEvents.nextAttemptAt)
        .limit(limit)
        .for("update", { of: capiEvents, skipLocked: true });
      // Lease: the send happens after commit, so push the rows out of other ticks' "due" window.
      if (rows.length > 0) {
        await tx
          .update(capiEvents)
          .set({ nextAttemptAt: new Date(now.getTime() + CAPI_LEASE_MS) })
          .where(inArray(capiEvents.id, rows.map((r) => r.rowId)));
      }
      return rows.map((r) => {
        const ev: DueCapiEvent = {
          rowId: r.rowId,
          eventId: r.eventId,
          eventName: r.eventName,
          eventTime: r.eventTime,
          attempts: r.attempts,
          phoneE164: r.phoneE164,
          ctwaClid: r.ctwaClid,
        };
        if (r.eventName === "Purchase" && r.totalMinor !== null && r.currency !== null) {
          ev.value = { amountMinor: Number(r.totalMinor), currency: r.currency };
        }
        return ev;
      });
    },
    async applyOutcomes(outcomes, now) {
      for (const o of outcomes) {
        const s = nextState(o.attempts, o.result, now);
        await tx
          .update(capiEvents)
          .set({ status: s.status, attempts: s.attempts, sentAt: s.sentAt, lastError: s.lastError, nextAttemptAt: s.nextAttemptAt })
          // Never downgrade a row another tick already finished.
          .where(and(eq(capiEvents.id, o.rowId), eq(capiEvents.status, "pending")));
      }
    },
  };
}
