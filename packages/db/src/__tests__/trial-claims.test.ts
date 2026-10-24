import { createHmac, randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type DbHandle } from "../client.js";
import { runMigrations } from "../migrate.js";
import { channelConnections, tenantPlans, tenants, trialClaims } from "../schema/index.js";
import { dangerouslyWithoutTenant, withTenant } from "../with-tenant.js";

const MIGRATOR_URL = process.env.DATABASE_URL_MIGRATOR;
const APP_URL = process.env.DATABASE_URL;
const hasDb = Boolean(MIGRATOR_URL && APP_URL);

const pgCode = (err: unknown): string | undefined =>
  typeof err === "object" && err !== null ? ((err as { code?: string }).code ?? (err as { cause?: { code?: string } }).cause?.code) : undefined;

const identity = (phone: string) => `phone:${createHmac("sha256", "test-secret-0123456789").update(`phone:${phone}`).digest("hex")}`;

describe.skipIf(!hasDb)("trial claims: one free trial per number for life (0069)", () => {
  let migrator: DbHandle;
  let app: DbHandle;
  const ids: string[] = [];
  const phone = `+5917${Math.floor(Math.random() * 1e7).toString().padStart(7, "0")}`;

  const newTenantWithChannel = async (): Promise<{ tenantId: string; channelId: string }> =>
    dangerouslyWithoutTenant(migrator.db, async (tx) => {
      const [t] = await tx.insert(tenants).values({ slug: `claims-${randomUUID().slice(0, 8)}`, name: "Claims" }).returning({ id: tenants.id });
      const tenantId = t?.id ?? "";
      ids.push(tenantId);
      const [c] = await tx
        .insert(channelConnections)
        .values({ tenantId, provider: "gupshup", phoneE164: phone, webhookToken: randomUUID(), status: "active" })
        .returning({ id: channelConnections.id });
      return { tenantId, channelId: c?.id ?? "" };
    });
  const start = (tenantId: string, channelId: string, identities: string[]) =>
    withTenant(app.db, tenantId, async (tx) => {
      const [r] = await tx.execute<{ outcome: string }>(
        sql`select public.tenant_trial_start(${channelId}::uuid, ${sql.raw(`ARRAY[${identities.map((i) => `'${i}'`).join(",")}]::text[]`)}) as outcome`,
      );
      return r?.outcome;
    });
  const planOf = (tenantId: string) =>
    dangerouslyWithoutTenant(migrator.db, async (tx) => (await tx.select().from(tenantPlans).where(eq(tenantPlans.tenantId, tenantId)))[0]);

  beforeAll(async () => {
    await runMigrations(MIGRATOR_URL as string);
    migrator = createDb(MIGRATOR_URL as string, { max: 1 });
    app = createDb(APP_URL as string, { max: 2 });
  });

  afterAll(async () => {
    if (migrator) {
      await dangerouslyWithoutTenant(migrator.db, async (tx) => {
        await tx.delete(trialClaims).where(inArray(trialClaims.firstTenantId, ids));
        await tx.delete(tenants).where(inArray(tenants.id, ids));
      });
      await migrator.close();
    }
    if (app) await app.close();
  });

  it("the first tenant gets the trial; a second tenant with the same number is denied (payment required)", async () => {
    const a = await newTenantWithChannel();
    expect(await start(a.tenantId, a.channelId, [identity(phone)])).toBe("started");
    const b = await newTenantWithChannel();
    expect(await start(b.tenantId, b.channelId, [identity(phone)])).toBe("denied");
    expect((await planOf(b.tenantId))?.trialDeniedAt).toBeInstanceOf(Date);
    expect((await planOf(b.tenantId))?.trialStartedAt).toBeNull();
    // Exactly one claim, owned by the first tenant; only the hash is stored.
    const rows = await dangerouslyWithoutTenant(migrator.db, (tx) => tx.select().from(trialClaims).where(inArray(trialClaims.firstTenantId, ids)));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.firstTenantId).toBe(a.tenantId);
    expect(rows[0]?.identityHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(rows)).not.toContain(phone.slice(1));
  });

  it("concurrent claims of one new number give exactly one trial", async () => {
    const fresh = `+5916${Math.floor(Math.random() * 1e7).toString().padStart(7, "0")}`;
    const mk = async () =>
      dangerouslyWithoutTenant(migrator.db, async (tx) => {
        const [t] = await tx.insert(tenants).values({ slug: `race-${randomUUID().slice(0, 8)}`, name: "Race" }).returning({ id: tenants.id });
        const tenantId = t?.id ?? "";
        ids.push(tenantId);
        const [c] = await tx
          .insert(channelConnections)
          .values({ tenantId, provider: "gupshup", phoneE164: fresh, webhookToken: randomUUID(), status: "active" })
          .returning({ id: channelConnections.id });
        return { tenantId, channelId: c?.id ?? "" };
      });
    const [x, y] = [await mk(), await mk()];
    const outcomes = await Promise.all([start(x.tenantId, x.channelId, [identity(fresh)]), start(y.tenantId, y.channelId, [identity(fresh)])]);
    expect(outcomes.sort()).toEqual(["denied", "started"]);
  });

  it("tenants cannot read or write trial_claims (platform-level table)", async () => {
    const tenantId = ids[0] ?? "";
    const read = await withTenant(app.db, tenantId, (tx) => tx.select().from(trialClaims)).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(pgCode(read)).toBe("42501");
    const write = await withTenant(app.db, tenantId, (tx) =>
      tx.insert(trialClaims).values({ identityType: "phone", identityHash: "0".repeat(64), firstTenantId: tenantId }),
    ).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(pgCode(write)).toBe("42501");
  });

  it("rejects malformed identities", async () => {
    const a = await newTenantWithChannel();
    const err = await start(a.tenantId, a.channelId, ["phone:not-a-hash"]).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(pgCode(err)).toBe("22023");
  });
});
