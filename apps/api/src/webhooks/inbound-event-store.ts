import type { DbHandle } from "@crmwsp/db";

/** BSPs whose callbacks land in inbound_events (enum channel_provider). */
export type BspProvider = "gupshup" | "360dialog";

export interface IngestResult {
  /** Null when the dedupe key already belongs to another connection's event (nothing revealed). */
  eventId: string | null;
  tenantId: string;
  inserted: boolean;
}

/** Port over `ingest_inbound_event` so the controller can be tested with a fake. */
export interface InboundEventStore {
  /** Returns null when the token does not match an enabled connection. */
  ingest(token: string, dedupeKey: string, payload: unknown, signatureValid: boolean, provider?: BspProvider): Promise<IngestResult | null>;
}

interface IngestRow {
  event_id: string | null;
  tenant_id: string;
  inserted: boolean;
}

/**
 * Uses the app role (DATABASE_URL). Insertion only through the SECURITY DEFINER function,
 * which resolves tenant and connection from the token (ADR 0002); no tenant-scoped table is
 * touched directly here, so withTenant() is not involved.
 *
 * Note: uses the raw postgres.js client instead of drizzle-orm because apps/api is CommonJS
 * and @crmwsp/db is ESM; mixing both drizzle builds breaks type identity.
 */
export class PgInboundEventStore implements InboundEventStore {
  constructor(private readonly sql: DbHandle["sql"]) {}

  async ingest(
    token: string,
    dedupeKey: string,
    payload: unknown,
    signatureValid: boolean,
    provider: BspProvider = "gupshup",
  ): Promise<IngestResult | null> {
    const rows = await this.sql<IngestRow[]>`
      select event_id, tenant_id, inserted
      from public.ingest_inbound_event(
        ${provider}::public.channel_provider, ${token}, ${dedupeKey}, ${JSON.stringify(payload ?? null)}::jsonb, ${signatureValid}
      )`;
    const row = rows[0];
    if (!row) return null;
    return { eventId: row.event_id, tenantId: row.tenant_id, inserted: row.inserted };
  }
}
