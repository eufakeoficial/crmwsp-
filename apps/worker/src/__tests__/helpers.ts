import { randomUUID } from "node:crypto";
import { channelConnections, createDb, dangerouslyWithoutTenant, tenants, type DbHandle } from "@crmwsp/db";
import { generateWebhookToken } from "@crmwsp/whatsapp";
import { inArray, sql } from "drizzle-orm";

export const MIGRATOR_URL = process.env["DATABASE_URL_MIGRATOR"];
export const APP_URL = process.env["DATABASE_URL"];
export const REDIS_URL = process.env["REDIS_URL"];
export const hasEnv = Boolean(MIGRATOR_URL && APP_URL && REDIS_URL);

export interface SeedTenant {
  tenantId: string;
  connectionId: string;
  token: string;
}

export async function seedTenants(migrator: DbHandle, n: number): Promise<SeedTenant[]> {
  const suffix = randomUUID().slice(0, 8);
  return dangerouslyWithoutTenant(migrator.db, async (tx) => {
    const out: SeedTenant[] = [];
    for (let i = 0; i < n; i++) {
      const [t] = await tx
        .insert(tenants)
        .values({ slug: `wrk-${i}-${suffix}`, name: `Worker ${i}` })
        .returning({ id: tenants.id });
      if (!t) throw new Error("seed failed");
      const token = generateWebhookToken();
      const [c] = await tx
        .insert(channelConnections)
        .values({ tenantId: t.id, provider: "gupshup", phoneE164: "+34600000001", webhookToken: token, status: "active" })
        .returning({ id: channelConnections.id });
      if (!c) throw new Error("seed failed");
      out.push({ tenantId: t.id, connectionId: c.id, token });
    }
    return out;
  });
}

export async function dropTenants(migrator: DbHandle, ids: string[]): Promise<void> {
  if (ids.length) await migrator.db.delete(tenants).where(inArray(tenants.id, ids));
}

export function textPayload(id: string, phone = "5491155551234", text = "Hola", name = "Juan Perez"): unknown {
  return {
    app: "DemoApp",
    timestamp: 1729339200000,
    version: 2,
    type: "message",
    payload: { id, source: phone, type: "text", payload: { text }, sender: { phone, name } },
  };
}

export function imagePayload(id: string, phone = "5491155551234"): unknown {
  return {
    app: "DemoApp",
    timestamp: 1729339200000,
    version: 2,
    type: "message",
    payload: {
      id,
      source: phone,
      type: "image",
      payload: { caption: "Foto", url: "https://filemanager.gupshup.io/wa/x/img1", contentType: "image/jpeg" },
      sender: { phone, name: "Juan" },
    },
  };
}

export function statusPayload(id: string, type: "sent" | "delivered" | "read" | "failed"): unknown {
  return {
    app: "DemoApp",
    timestamp: 1729339260000,
    version: 2,
    type: "message-event",
    payload: { id: `g-${id}`, gsId: id, type, destination: "5491155551234", payload: { ts: 1729339262 } },
  };
}

/** Inserts through ingest_inbound_event with the app role, as the API does. */
export async function ingest(app: DbHandle, token: string, dedupeKey: string, payload: unknown): Promise<string> {
  const rows = await app.db.execute<{ event_id: string }>(
    sql`select event_id from public.ingest_inbound_event('gupshup', ${token}, ${dedupeKey}, ${JSON.stringify(payload)}::jsonb, false)`,
  );
  const id = rows[0]?.event_id;
  if (!id) throw new Error("ingest failed");
  return id;
}

export { createDb };
