import { createHash, randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type DbHandle } from "../client.js";
import { runMigrations } from "../migrate.js";
import { apiKeys, tenants, webhookDeliveries, webhookEndpoints } from "../schema/index.js";
import { enqueueWebhookEvent } from "../webhook-events.js";
import { dangerouslyWithoutTenant, withTenant } from "../with-tenant.js";

const MIGRATOR_URL = process.env.DATABASE_URL_MIGRATOR;
const APP_URL = process.env.DATABASE_URL;
const hasDb = Boolean(MIGRATOR_URL && APP_URL);

type PgCause = { code?: string };
const pgCause = (err: unknown): PgCause | undefined => (err as Error & { cause?: PgCause } | undefined)?.cause ?? (err as PgCause | undefined);
const settle = <T>(p: Promise<T>): Promise<unknown> => p.then(() => undefined, (e: unknown) => e);
const hash = (k: string): Buffer => createHash("sha256").update(k).digest();

interface Seed {
  tenant: string;
  key: string;
  keyPlain: string;
  endpoint: string;
  disabledEndpoint: string;
  delivery: string;
}

describe.skipIf(!hasDb)("api keys and outbound webhooks RLS with the app role", () => {
  let migrator: DbHandle;
  let app: DbHandle;
  const suffix = randomUUID().slice(0, 8);
  let A: Seed;
  let B: Seed;

  async function seed(label: string): Promise<Seed> {
    return dangerouslyWithoutTenant(migrator.db, async (tx) => {
      const [t] = await tx.insert(tenants).values({ slug: `dev-${label}-${suffix}`, name: label }).returning({ id: tenants.id });
      if (!t) throw new Error("seed");
      const keyPlain = `crm_live_${randomUUID().replace(/-/g, "")}${label}`;
      const [k] = await tx
        .insert(apiKeys)
        .values({ tenantId: t.id, name: "k", prefix: keyPlain.slice(0, 17), keyHash: hash(keyPlain), scopes: ["read:orders"] })
        .returning({ id: apiKeys.id });
      const [e] = await tx
        .insert(webhookEndpoints)
        .values({ tenantId: t.id, url: "https://hooks.example.com/a", events: ["order.paid", "contact.created"], secretEncrypted: Buffer.from("x") })
        .returning({ id: webhookEndpoints.id });
      const [e2] = await tx
        .insert(webhookEndpoints)
        .values({ tenantId: t.id, url: "https://hooks.example.com/b", events: ["order.paid"], secretEncrypted: Buffer.from("x"), status: "disabled" })
        .returning({ id: webhookEndpoints.id });
      if (!k || !e || !e2) throw new Error("seed");
      const [d] = await tx
        .insert(webhookDeliveries)
        .values({ tenantId: t.id, endpointId: e.id, eventId: randomUUID(), eventType: "order.paid", payload: {} })
        .returning({ id: webhookDeliveries.id });
      if (!d) throw new Error("seed");
      return { tenant: t.id, key: k.id, keyPlain, endpoint: e.id, disabledEndpoint: e2.id, delivery: d.id };
    });
  }

  beforeAll(async () => {
    await runMigrations(MIGRATOR_URL as string);
    migrator = createDb(MIGRATOR_URL as string, { max: 1 });
    app = createDb(APP_URL as string, { max: 1 });
    A = await seed("a");
    B = await seed("b");
  });
  afterAll(async () => {
    if (migrator) {
      const ids = [A?.tenant, B?.tenant].filter((x): x is string => Boolean(x));
      if (ids.length) await migrator.db.delete(tenants).where(inArray(tenants.id, ids));
      await migrator.close();
    }
    if (app) await app.close();
  });

  it("each tenant only sees its own keys, endpoints and deliveries", async () => {
    await withTenant(app.db, A.tenant, async (tx) => {
      expect((await tx.select({ id: apiKeys.id }).from(apiKeys)).map((r) => r.id)).toEqual([A.key]);
      expect((await tx.select({ id: webhookEndpoints.id }).from(webhookEndpoints)).map((r) => r.id).sort()).toEqual([A.endpoint, A.disabledEndpoint].sort());
      expect((await tx.select({ id: webhookDeliveries.id }).from(webhookDeliveries)).map((r) => r.id)).toEqual([A.delivery]);
      const upd = await tx.update(webhookEndpoints).set({ url: "https://evil.example.com" }).where(eq(webhookEndpoints.id, B.endpoint)).returning();
      expect(upd).toHaveLength(0);
    });
  });

  it("rejects writes carrying another tenant id", async () => {
    const err = await settle(
      withTenant(app.db, A.tenant, (tx) =>
        tx.insert(apiKeys).values({ tenantId: B.tenant, name: "x", prefix: "p", keyHash: hash(randomUUID()), scopes: ["read:orders"] }),
      ),
    );
    expect(pgCause(err)?.code).toBe("42501");
    // A delivery of tenant A cannot point at tenant B's endpoint (composite FK).
    const fk = await settle(
      dangerouslyWithoutTenant(migrator.db, (tx) =>
        tx.insert(webhookDeliveries).values({ tenantId: A.tenant, endpointId: B.endpoint, eventId: randomUUID(), eventType: "order.paid", payload: {} }),
      ),
    );
    expect(pgCause(fk)?.code).toBe("23503");
  });

  it("the app role cannot see rows without tenant context nor delete api keys", async () => {
    expect(await app.db.select().from(apiKeys)).toHaveLength(0);
    const del = await settle(withTenant(app.db, A.tenant, (tx) => tx.delete(apiKeys).where(eq(apiKeys.id, A.key))));
    expect(pgCause(del)?.code).toBe("42501");
  });

  it("resolve_api_key resolves only non-revoked keys to their own tenant", async () => {
    const r = await app.sql`select tenant_id, api_key_id, scopes from resolve_api_key(${hash(A.keyPlain)})`;
    expect(r[0]?.["tenant_id"]).toBe(A.tenant);
    expect(r[0]?.["scopes"]).toEqual(["read:orders"]);
    expect(await app.sql`select * from resolve_api_key(${hash("nope")})`).toHaveLength(0);
    await withTenant(app.db, B.tenant, (tx) => tx.update(apiKeys).set({ revokedAt: new Date() }).where(eq(apiKeys.id, B.key)));
    expect(await app.sql`select * from resolve_api_key(${hash(B.keyPlain)})`).toHaveLength(0);
  });

  it("enqueueWebhookEvent fans out only to active subscribed endpoints of the tenant", async () => {
    const n = await withTenant(app.db, A.tenant, (tx) => enqueueWebhookEvent(tx, A.tenant, "order.paid", { orderId: "o1" }));
    expect(n).toBe(1);
    expect(await withTenant(app.db, A.tenant, (tx) => enqueueWebhookEvent(tx, A.tenant, "message.received", {}))).toBe(0);
    const rows = await withTenant(app.db, B.tenant, (tx) => tx.select().from(webhookDeliveries));
    expect(rows).toHaveLength(1); // B unaffected
    const ids = await app.db.execute<{ tenant_id: string }>(sql`select tenant_id from webhook_delivery_tenant_ids()`);
    expect(ids.map((r) => r.tenant_id)).toEqual(expect.arrayContaining([A.tenant, B.tenant]));
  });
});
