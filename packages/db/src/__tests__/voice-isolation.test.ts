import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type DbHandle } from "../client.js";
import { runMigrations } from "../migrate.js";
import { tenants, usageLedger, voiceSettings } from "../schema/index.js";
import { dangerouslyWithoutTenant, withTenant } from "../with-tenant.js";

const MIGRATOR_URL = process.env.DATABASE_URL_MIGRATOR;
const APP_URL = process.env.DATABASE_URL;
const hasDb = Boolean(MIGRATOR_URL && APP_URL);

const settle = <T>(p: Promise<T>): Promise<unknown> =>
  p.then(
    () => undefined,
    (err: unknown) => err,
  );

describe.skipIf(!hasDb)("voice_settings RLS with the app role", () => {
  let migrator: DbHandle;
  let app: DbHandle;
  const suffix = randomUUID().slice(0, 8);
  let A: { tenant: string; voice: string };
  let B: { tenant: string; voice: string };

  async function seed(label: string): Promise<{ tenant: string; voice: string }> {
    return dangerouslyWithoutTenant(migrator.db, async (tx) => {
      const [t] = await tx
        .insert(tenants)
        .values({ slug: `voice-${label}-${suffix}`, name: `Tenant ${label}` })
        .returning({ id: tenants.id });
      if (!t) throw new Error("seed failed");
      const [v] = await tx
        .insert(voiceSettings)
        .values({ tenantId: t.id, apiKeyEncrypted: Buffer.from(`k-${label}`), apiKeyHint: "…abcd", voiceId: `voice-${label}`, replyMode: "mirror" })
        .returning({ id: voiceSettings.id });
      if (!v) throw new Error("seed failed");
      return { tenant: t.id, voice: v.id };
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

  it("tenant A only sees its own voice settings", async () => {
    const rows = await withTenant(app.db, A.tenant, (tx) =>
      tx.select({ id: voiceSettings.id, tenantId: voiceSettings.tenantId }).from(voiceSettings),
    );
    expect(rows.map((r) => r.id)).toEqual([A.voice]);
    expect(await app.db.select({ id: voiceSettings.id }).from(voiceSettings)).toHaveLength(0);
  });

  it("tenant A cannot update, delete nor insert B's voice settings", async () => {
    const upd = await withTenant(app.db, A.tenant, (tx) =>
      tx.update(voiceSettings).set({ replyMode: "always" }).where(eq(voiceSettings.id, B.voice)).returning({ id: voiceSettings.id }),
    );
    expect(upd).toHaveLength(0);
    const del = await withTenant(app.db, A.tenant, (tx) =>
      tx.delete(voiceSettings).where(eq(voiceSettings.id, B.voice)).returning({ id: voiceSettings.id }),
    );
    expect(del).toHaveLength(0);
    const ins = await settle(
      withTenant(app.db, A.tenant, (tx) => tx.insert(voiceSettings).values({ tenantId: B.tenant, voiceId: "x" })),
    );
    expect(ins).toBeInstanceOf(Error);
  });

  it("accepts the tts_characters usage kind", async () => {
    const [row] = await withTenant(app.db, A.tenant, (tx) =>
      tx
        .insert(usageLedger)
        .values({ tenantId: A.tenant, kind: "tts_characters", quantity: "12", unit: "characters", currency: "USD" })
        .returning({ id: usageLedger.id }),
    );
    expect(row?.id).toBeTruthy();
  });
});
