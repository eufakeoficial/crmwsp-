import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type DbHandle } from "../client.js";
import { runMigrations } from "../migrate.js";
import { channelConnections, channelQualityEvents, tenants } from "../schema/index.js";
import { dangerouslyWithoutTenant, withTenant } from "../with-tenant.js";

const MIGRATOR_URL = process.env.DATABASE_URL_MIGRATOR;
const APP_URL = process.env.DATABASE_URL;
const hasDb = Boolean(MIGRATOR_URL && APP_URL);

const settle = <T>(p: Promise<T>): Promise<unknown> =>
  p.then(
    () => undefined,
    (err: unknown) => err,
  );

describe.skipIf(!hasDb)("channel_quality_events RLS with the app role", () => {
  let migrator: DbHandle;
  let app: DbHandle;
  const suffix = randomUUID().slice(0, 8);
  let A: { tenant: string; channel: string; event: string };
  let B: { tenant: string; channel: string; event: string };

  async function seed(label: string, phone: string): Promise<{ tenant: string; channel: string; event: string }> {
    return dangerouslyWithoutTenant(migrator.db, async (tx) => {
      const [t] = await tx.insert(tenants).values({ slug: `cq-${label}-${suffix}`, name: `CQ ${label}` }).returning({ id: tenants.id });
      if (!t) throw new Error("seed failed");
      const [c] = await tx
        .insert(channelConnections)
        .values({ tenantId: t.id, provider: "360dialog", phoneE164: phone, webhookToken: `cq-${label}-${suffix}` })
        .returning({ id: channelConnections.id });
      if (!c) throw new Error("seed failed");
      const [e] = await tx
        .insert(channelQualityEvents)
        .values({ tenantId: t.id, channelConnectionId: c.id, field: "phone_number_quality_update", event: "FLAGGED", severity: "warning" })
        .returning({ id: channelQualityEvents.id });
      if (!e) throw new Error("seed failed");
      return { tenant: t.id, channel: c.id, event: e.id };
    });
  }

  beforeAll(async () => {
    await runMigrations(MIGRATOR_URL as string);
    migrator = createDb(MIGRATOR_URL as string, { max: 1 });
    app = createDb(APP_URL as string, { max: 1 });
    A = await seed("a", "+34600000201");
    B = await seed("b", "+34600000202");
  });

  afterAll(async () => {
    if (migrator) {
      const ids = [A?.tenant, B?.tenant].filter((x): x is string => Boolean(x));
      if (ids.length) await migrator.db.delete(tenants).where(inArray(tenants.id, ids));
      await migrator.close();
    }
    if (app) await app.close();
  });

  it("tenant A only sees its own events, and nothing without a tenant", async () => {
    const rows = await withTenant(app.db, A.tenant, (tx) => tx.select({ id: channelQualityEvents.id }).from(channelQualityEvents));
    expect(rows.map((r) => r.id)).toEqual([A.event]);
    expect(await app.db.select({ id: channelQualityEvents.id }).from(channelQualityEvents)).toHaveLength(0);
  });

  it("tenant A cannot update, delete nor insert B's events", async () => {
    const upd = await withTenant(app.db, A.tenant, (tx) =>
      tx.update(channelQualityEvents).set({ severity: "info" }).where(eq(channelQualityEvents.id, B.event)).returning({ id: channelQualityEvents.id }),
    );
    expect(upd).toHaveLength(0);
    const del = await withTenant(app.db, A.tenant, (tx) => tx.delete(channelQualityEvents).where(eq(channelQualityEvents.id, B.event)).returning({ id: channelQualityEvents.id }));
    expect(del).toHaveLength(0);
    const ins = await settle(
      withTenant(app.db, A.tenant, (tx) =>
        tx.insert(channelQualityEvents).values({ tenantId: B.tenant, channelConnectionId: B.channel, field: "account_update", severity: "critical" }),
      ),
    );
    expect(ins).toBeInstanceOf(Error);
    // Cross-tenant channel reference is rejected by the composite FK even with A's tenant id.
    const fk = await settle(
      withTenant(app.db, A.tenant, (tx) =>
        tx.insert(channelQualityEvents).values({ tenantId: A.tenant, channelConnectionId: B.channel, field: "account_update", severity: "critical" }),
      ),
    );
    expect(fk).toBeInstanceOf(Error);
  });

  it("the platform alert list refuses non-admins", async () => {
    const err = await settle(app.sql`select * from public.platform_channel_quality_alerts(${A.tenant}, 30)`);
    expect(err).toBeInstanceOf(Error);
  });
});
