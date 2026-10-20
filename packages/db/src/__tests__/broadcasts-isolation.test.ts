import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type DbHandle } from "../client.js";
import { runMigrations } from "../migrate.js";
import { broadcastRecipients, broadcasts, channelConnections, contacts, messageTemplates, tenants } from "../schema/index.js";
import { dangerouslyWithoutTenant, withTenant } from "../with-tenant.js";

const MIGRATOR_URL = process.env.DATABASE_URL_MIGRATOR;
const APP_URL = process.env.DATABASE_URL;
const hasDb = Boolean(MIGRATOR_URL && APP_URL);

const pgCode = (err: unknown): string | undefined =>
  ((err as Error & { cause?: { code?: string } } | undefined)?.cause ?? (err as { code?: string } | undefined))?.code;
const settle = <T>(p: Promise<T>): Promise<unknown> =>
  p.then(
    () => undefined,
    (err: unknown) => err,
  );

interface Seed {
  tenant: string;
  conn: string;
  template: string;
  contact: string;
  broadcast: string;
  recipient: string;
}

describe.skipIf(!hasDb)("broadcast tables isolation (RLS) with the app role", () => {
  let migrator: DbHandle;
  let app: DbHandle;
  const suffix = randomUUID().slice(0, 8);
  const A = {} as Seed;
  const B = {} as Seed;

  beforeAll(async () => {
    await runMigrations(MIGRATOR_URL as string);
    migrator = createDb(MIGRATOR_URL as string, { max: 1 });
    app = createDb(APP_URL as string, { max: 1 });
    await dangerouslyWithoutTenant(migrator.db, async (tx) => {
      for (const [s, label] of [
        [A, "a"],
        [B, "b"],
      ] as const) {
        const [t] = await tx.insert(tenants).values({ slug: `bc-${label}-${suffix}`, name: `BC ${label}` }).returning({ id: tenants.id });
        if (!t) throw new Error("seed failed");
        s.tenant = t.id;
        const [c] = await tx
          .insert(channelConnections)
          .values({ tenantId: t.id, provider: "gupshup", phoneE164: "+34600000000", webhookToken: `bc-${randomUUID()}` })
          .returning({ id: channelConnections.id });
        const [tpl] = await tx
          .insert(messageTemplates)
          .values({ tenantId: t.id, channelConnectionId: c!.id, name: "promo", language: "es", category: "marketing", body: "Hola {{1}}", status: "approved" })
          .returning({ id: messageTemplates.id });
        const [ct] = await tx.insert(contacts).values({ tenantId: t.id, phoneE164: "+34611111111" }).returning({ id: contacts.id });
        const [bc] = await tx
          .insert(broadcasts)
          .values({ tenantId: t.id, name: "Promo", channelConnectionId: c!.id, templateId: tpl!.id })
          .returning({ id: broadcasts.id });
        const [r] = await tx
          .insert(broadcastRecipients)
          .values({ tenantId: t.id, broadcastId: bc!.id, contactId: ct!.id, phoneE164: "+34611111111" })
          .returning({ id: broadcastRecipients.id });
        s.conn = c!.id;
        s.template = tpl!.id;
        s.contact = ct!.id;
        s.broadcast = bc!.id;
        s.recipient = r!.id;
      }
    });
  });

  afterAll(async () => {
    if (migrator) {
      const ids = [A.tenant, B.tenant].filter(Boolean);
      if (ids.length) await dangerouslyWithoutTenant(migrator.db, (tx) => tx.delete(tenants).where(inArray(tenants.id, ids)));
      await migrator.close();
    }
    if (app) await app.close();
  });

  it("selects only the current tenant's broadcasts and recipients", async () => {
    const r = await withTenant(app.db, A.tenant, async (tx) => ({
      b: await tx.select({ id: broadcasts.id }).from(broadcasts),
      r: await tx.select({ id: broadcastRecipients.id }).from(broadcastRecipients),
    }));
    expect(r.b).toEqual([{ id: A.broadcast }]);
    expect(r.r).toEqual([{ id: A.recipient }]);
  });

  it("cannot update another tenant's broadcast (0 rows)", async () => {
    const rows = await withTenant(app.db, A.tenant, (tx) =>
      tx.update(broadcasts).set({ status: "cancelled" }).where(eq(broadcasts.id, B.broadcast)).returning({ id: broadcasts.id }),
    );
    expect(rows).toEqual([]);
  });

  it("cannot insert rows for another tenant (WITH CHECK)", async () => {
    const err = await settle(
      withTenant(app.db, A.tenant, (tx) =>
        tx.insert(broadcasts).values({ tenantId: B.tenant, name: "x", channelConnectionId: B.conn, templateId: B.template }),
      ),
    );
    expect(pgCode(err)).toBe("42501");
  });

  it("composite FKs reject cross-tenant references", async () => {
    const cases: Array<() => Promise<unknown>> = [
      () => withTenant(app.db, A.tenant, (tx) => tx.insert(broadcasts).values({ tenantId: A.tenant, name: "x", channelConnectionId: A.conn, templateId: B.template })),
      () => withTenant(app.db, A.tenant, (tx) => tx.insert(broadcastRecipients).values({ tenantId: A.tenant, broadcastId: A.broadcast, contactId: B.contact, phoneE164: "+1" })),
    ];
    for (const run of cases) expect(pgCode(await settle(run()))).toBe("23503");
  });

  it("one recipient per (broadcast, contact) and the app role cannot delete recipients", async () => {
    const dup = await settle(
      withTenant(app.db, A.tenant, (tx) =>
        tx.insert(broadcastRecipients).values({ tenantId: A.tenant, broadcastId: A.broadcast, contactId: A.contact, phoneE164: "+34622222222" }),
      ),
    );
    expect(pgCode(dup)).toBe("23505");
    const del = await settle(withTenant(app.db, A.tenant, (tx) => tx.delete(broadcastRecipients)));
    expect(pgCode(del)).toBe("42501");
  });
});
