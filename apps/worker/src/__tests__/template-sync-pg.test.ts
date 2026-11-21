import { messageTemplates, withTenant, type DbHandle } from "@crmwsp/db";
import { planTemplateSync } from "@crmwsp/domain";
import type { ProviderTemplate } from "@crmwsp/whatsapp";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPgTemplateSyncStore } from "../templates/sync.js";
import { APP_URL, MIGRATOR_URL, createDb, dropTenants, hasEnv, seedTenants, type SeedTenant } from "./helpers.js";

const remote = (o: Partial<ProviderTemplate> & { name: string }): ProviderTemplate => ({
  externalId: `ext-${o.name}`,
  language: "es",
  category: "utility",
  status: "approved",
  body: "Hola",
  ...o,
});

describe.skipIf(!hasEnv)("template sync store (Postgres, RLS)", () => {
  let migrator: DbHandle;
  let app: DbHandle;
  let A: SeedTenant;
  let B: SeedTenant;

  beforeAll(async () => {
    migrator = createDb(MIGRATOR_URL as string, { max: 2 });
    app = createDb(APP_URL as string);
    [A, B] = (await seedTenants(migrator, 2)) as [SeedTenant, SeedTenant];
  });
  afterAll(async () => {
    if (migrator) {
      await dropTenants(migrator, [A, B].filter(Boolean).map((t) => t.tenantId));
      await migrator.close();
    }
    await app?.close();
  });

  const sync = (t: SeedTenant, list: ProviderTemplate[]) =>
    withTenant(app.db, t.tenantId, async (tx) => {
      const store = createPgTemplateSyncStore(tx, t.tenantId);
      const plan = planTemplateSync(await store.loadTemplates(t.connectionId), list);
      await store.apply(t.connectionId, plan, new Date());
      return plan;
    });
  const rows = (t: SeedTenant) =>
    withTenant(app.db, t.tenantId, (tx) => tx.select().from(messageTemplates).where(eq(messageTemplates.channelConnectionId, t.connectionId)));

  it("imports with the rejection reason, then clears it when the template is approved again; tenants stay isolated", async () => {
    await sync(A, [remote({ name: "promo", status: "rejected", reason: "INVALID_FORMAT" }), remote({ name: "pausada", status: "paused" })]);
    const first = await rows(A);
    expect(first.find((r) => r.name === "promo")).toMatchObject({ status: "rejected", rejectionReason: "INVALID_FORMAT" });
    expect(first.find((r) => r.name === "pausada")).toMatchObject({ status: "paused", rejectionReason: null });

    await sync(A, [remote({ name: "promo" })]);
    expect((await rows(A)).find((r) => r.name === "promo")).toMatchObject({ status: "approved", rejectionReason: null });
    expect(await rows(B)).toEqual([]);
  });
});
