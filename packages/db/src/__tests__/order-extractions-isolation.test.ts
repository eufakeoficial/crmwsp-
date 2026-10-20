import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type DbHandle } from "../client.js";
import { runMigrations } from "../migrate.js";
import { channelConnections, contacts, conversations, messages, orderExtractions, tenants } from "../schema/index.js";
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
  conversation: string;
  message: string;
  message2: string;
  extraction: string;
}

describe.skipIf(!hasDb)("order_extractions isolation (RLS) with the app role", () => {
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
        const [t] = await tx.insert(tenants).values({ slug: `oe-${label}-${suffix}`, name: `OE ${label}` }).returning({ id: tenants.id });
        if (!t) throw new Error("seed failed");
        const [c] = await tx
          .insert(channelConnections)
          .values({ tenantId: t.id, provider: "gupshup", phoneE164: "+34600000000", webhookToken: `oe-${randomUUID()}` })
          .returning({ id: channelConnections.id });
        const [ct] = await tx.insert(contacts).values({ tenantId: t.id, phoneE164: "+34611111111" }).returning({ id: contacts.id });
        const [cv] = await tx
          .insert(conversations)
          .values({ tenantId: t.id, contactId: ct!.id, channelConnectionId: c!.id })
          .returning({ id: conversations.id });
        const msg = (n: number) => ({
          tenantId: t.id,
          conversationId: cv!.id,
          direction: "inbound" as const,
          type: "audio" as const,
          body: null,
          externalId: `wamid-oe-${label}-${n}-${suffix}`,
          status: "received" as const,
          author: "contact" as const,
        });
        const [m] = await tx.insert(messages).values(msg(1)).returning({ id: messages.id });
        const [m2] = await tx.insert(messages).values(msg(2)).returning({ id: messages.id });
        const [oe] = await tx
          .insert(orderExtractions)
          .values({ tenantId: t.id, conversationId: cv!.id, messageId: m!.id, source: "audio", status: "needs_confirmation" })
          .returning({ id: orderExtractions.id });
        s.tenant = t.id;
        s.conversation = cv!.id;
        s.message = m!.id;
        s.message2 = m2!.id;
        s.extraction = oe!.id;
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

  it("selects only the current tenant's extractions", async () => {
    const rows = await withTenant(app.db, A.tenant, (tx) => tx.select({ id: orderExtractions.id }).from(orderExtractions));
    expect(rows).toEqual([{ id: A.extraction }]);
  });

  it("cannot update another tenant's extraction (0 rows)", async () => {
    const rows = await withTenant(app.db, A.tenant, (tx) =>
      tx.update(orderExtractions).set({ status: "discarded" }).where(eq(orderExtractions.id, B.extraction)).returning({ id: orderExtractions.id }),
    );
    expect(rows).toEqual([]);
  });

  it("cannot insert rows for another tenant (WITH CHECK)", async () => {
    const err = await settle(
      withTenant(app.db, A.tenant, (tx) =>
        tx.insert(orderExtractions).values({ tenantId: B.tenant, conversationId: B.conversation, messageId: B.message2, source: "pdf", status: "ready" }),
      ),
    );
    expect(pgCode(err)).toBe("42501");
  });

  it("composite FKs reject cross-tenant conversation/message references", async () => {
    const cases: Array<() => Promise<unknown>> = [
      () =>
        withTenant(app.db, A.tenant, (tx) =>
          tx.insert(orderExtractions).values({ tenantId: A.tenant, conversationId: B.conversation, messageId: A.message2, source: "image", status: "ready" }),
        ),
      () =>
        withTenant(app.db, A.tenant, (tx) =>
          tx.insert(orderExtractions).values({ tenantId: A.tenant, conversationId: A.conversation, messageId: B.message2, source: "image", status: "ready" }),
        ),
    ];
    for (const run of cases) expect(pgCode(await settle(run()))).toBe("23503");
  });

  it("one extraction per message, checks enforced, and the app role cannot delete", async () => {
    const dup = await settle(
      withTenant(app.db, A.tenant, (tx) =>
        tx.insert(orderExtractions).values({ tenantId: A.tenant, conversationId: A.conversation, messageId: A.message, source: "audio", status: "ready" }),
      ),
    );
    expect(pgCode(dup)).toBe("23505");
    const bad = await settle(
      withTenant(app.db, A.tenant, (tx) => tx.update(orderExtractions).set({ status: "paid" as never }).where(eq(orderExtractions.id, A.extraction))),
    );
    expect(pgCode(bad)).toBe("23514");
    const del = await settle(withTenant(app.db, A.tenant, (tx) => tx.delete(orderExtractions)));
    expect(pgCode(del)).toBe("42501");
  });
});
