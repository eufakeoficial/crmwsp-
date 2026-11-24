import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type DbHandle } from "../client.js";
import { runMigrations } from "../migrate.js";
import {
  auditEvents,
  channelConnections,
  contacts,
  conversations,
  memberships,
  messages,
  quoteSends,
  quotes,
  quoteUnansweredReviews,
  tenants,
  users,
} from "../schema/index.js";
import { dangerouslyWithoutTenant, withTenant } from "../with-tenant.js";

const MIGRATOR_URL = process.env.DATABASE_URL_MIGRATOR;
const APP_URL = process.env.DATABASE_URL;
const hasDb = Boolean(MIGRATOR_URL && APP_URL);

const settle = <T>(p: Promise<T>): Promise<unknown> =>
  p.then(
    () => undefined,
    (err: unknown) => err,
  );

interface Seed {
  tenant: string;
  user: string;
  contact: string;
  conversation: string;
  message: string;
  message2: string;
  quote: string;
  quote2: string;
  send: string;
  review: string;
}

describe.skipIf(!hasDb)("quote sends and unanswered-quote reviews RLS with the app role", () => {
  let migrator: DbHandle;
  let app: DbHandle;
  const suffix = randomUUID().slice(0, 8);
  let A: Seed;
  let B: Seed;

  async function seed(label: string): Promise<Seed> {
    return dangerouslyWithoutTenant(migrator.db, async (tx) => {
      const [t] = await tx
        .insert(tenants)
        .values({ slug: `quq-${label}-${suffix}`, name: `Tenant ${label}` })
        .returning({ id: tenants.id });
      const [u] = await tx
        .insert(users)
        .values({ email: `quq-${label}-${suffix}@example.test`, name: label })
        .returning({ id: users.id });
      if (!t || !u) throw new Error("seed failed");
      await tx.insert(memberships).values({ tenantId: t.id, userId: u.id, role: "owner" });
      const [c] = await tx
        .insert(channelConnections)
        .values({ tenantId: t.id, provider: "gupshup", phoneE164: "+34600000001", webhookToken: `tok-${randomUUID()}`, status: "active" })
        .returning({ id: channelConnections.id });
      const [ct] = await tx
        .insert(contacts)
        .values({ tenantId: t.id, phoneE164: "+34611111111", name: "Cli" })
        .returning({ id: contacts.id });
      if (!c || !ct) throw new Error("seed failed");
      const [cv] = await tx
        .insert(conversations)
        .values({ tenantId: t.id, contactId: ct.id, channelConnectionId: c.id })
        .returning({ id: conversations.id });
      if (!cv) throw new Error("seed failed");
      const validUntil = new Date(Date.now() + 86_400_000);
      const [q] = await tx
        .insert(quotes)
        .values({ tenantId: t.id, number: `QU-${label}-1-${suffix}`, contactId: ct.id, conversationId: cv.id, status: "sent", currency: "EUR", totalMinor: 1250n, validUntil, sentAt: new Date(), createdByType: "user" })
        .returning({ id: quotes.id });
      const [q2] = await tx
        .insert(quotes)
        .values({ tenantId: t.id, number: `QU-${label}-2-${suffix}`, contactId: ct.id, conversationId: cv.id, currency: "EUR", validUntil, createdByType: "user" })
        .returning({ id: quotes.id });
      const outbound = { tenantId: t.id, conversationId: cv.id, direction: "outbound" as const, type: "text" as const, body: "Presupuesto", status: "sent" as const, author: "user" as const, authorUserId: u.id, sentAt: new Date() };
      const [m] = await tx.insert(messages).values(outbound).returning({ id: messages.id });
      const [m2] = await tx.insert(messages).values(outbound).returning({ id: messages.id });
      if (!q || !q2 || !m || !m2) throw new Error("seed failed");
      const [s] = await tx.insert(quoteSends).values({ tenantId: t.id, quoteId: q.id, messageId: m.id }).returning({ id: quoteSends.id });
      const [r] = await tx
        .insert(quoteUnansweredReviews)
        .values({ tenantId: t.id, quoteId: q.id, messageId: m.id, reviewedBy: u.id })
        .returning({ id: quoteUnansweredReviews.id });
      if (!s || !r) throw new Error("seed failed");
      return { tenant: t.id, user: u.id, contact: ct.id, conversation: cv.id, message: m.id, message2: m2.id, quote: q.id, quote2: q2.id, send: s.id, review: r.id };
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

  const tables = [
    { name: "quote_sends", table: quoteSends, key: "send" },
    { name: "quote_unanswered_reviews", table: quoteUnansweredReviews, key: "review" },
  ] as const;

  for (const { name, table, key } of tables) {
    it(`${name}: tenant A only sees its own rows; no tenant sees nothing`, async () => {
      const rows = await withTenant(app.db, A.tenant, (tx) => tx.select({ id: table.id }).from(table));
      expect(rows.map((r) => r.id)).toEqual([A[key]]);
      expect(await app.db.select({ id: table.id }).from(table)).toHaveLength(0);
    });

    it(`${name}: tenant A cannot take over nor delete B's rows`, async () => {
      const upd = await withTenant(app.db, A.tenant, (tx) =>
        tx.update(table).set({ tenantId: A.tenant }).where(eq(table.id, B[key])).returning({ id: table.id }),
      );
      expect(upd).toHaveLength(0);
      const del = await withTenant(app.db, A.tenant, (tx) => tx.delete(table).where(eq(table.id, B[key])).returning({ id: table.id }));
      expect(del).toHaveLength(0);
    });
  }

  it("rejects inserts into another tenant and cross-tenant links", async () => {
    const foreignTenant = await settle(
      withTenant(app.db, A.tenant, (tx) => tx.insert(quoteSends).values({ tenantId: B.tenant, quoteId: B.quote2, messageId: B.message })),
    );
    expect(foreignTenant).toBeInstanceOf(Error);
    const foreignReview = await settle(
      withTenant(app.db, A.tenant, (tx) => tx.insert(quoteUnansweredReviews).values({ tenantId: B.tenant, quoteId: B.quote2, messageId: B.message })),
    );
    expect(foreignReview).toBeInstanceOf(Error);
    const crossMessage = await settle(
      withTenant(app.db, A.tenant, (tx) => tx.insert(quoteSends).values({ tenantId: A.tenant, quoteId: A.quote2, messageId: B.message })),
    );
    expect(crossMessage).toBeInstanceOf(Error);
    const crossQuote = await settle(
      withTenant(app.db, A.tenant, (tx) => tx.insert(quoteUnansweredReviews).values({ tenantId: A.tenant, quoteId: B.quote2, messageId: A.message })),
    );
    expect(crossQuote).toBeInstanceOf(Error);
  });

  it("keeps one send per quote", async () => {
    const dup = await settle(
      withTenant(app.db, A.tenant, (tx) => tx.insert(quoteSends).values({ tenantId: A.tenant, quoteId: A.quote, messageId: A.message2 })),
    );
    expect(dup).toBeInstanceOf(Error);
  });

  it("lets the tenant write its own send and review", async () => {
    const [s] = await withTenant(app.db, A.tenant, (tx) =>
      tx.insert(quoteSends).values({ tenantId: A.tenant, quoteId: A.quote2, messageId: A.message2 }).returning({ id: quoteSends.id }),
    );
    const [r] = await withTenant(app.db, A.tenant, (tx) =>
      tx
        .insert(quoteUnansweredReviews)
        .values({ tenantId: A.tenant, quoteId: A.quote2, messageId: A.message2, reviewedBy: A.user })
        .returning({ id: quoteUnansweredReviews.id }),
    );
    expect(s?.id).toBeTruthy();
    expect(r?.id).toBeTruthy();
  });

  it("backfills earlier sends from the quote.sent audit event and stays idempotent", async () => {
    const statements = readFileSync(new URL("../../drizzle/0104_quote_unanswered.sql", import.meta.url), "utf8")
      .split("--> statement-breakpoint")
      .map((s) => s.trim());
    const backfill = statements.find((s) => s.startsWith('INSERT INTO "quote_sends"'));
    if (!backfill) throw new Error("backfill statement not found");
    const legacy = await dangerouslyWithoutTenant(migrator.db, async (tx) => {
      const mkQuote = (n: number) =>
        tx
          .insert(quotes)
          .values({ tenantId: A.tenant, number: `QU-legacy-${n}-${suffix}`, contactId: A.contact, currency: "EUR", validUntil: new Date(Date.now() + 86_400_000), status: "sent", sentAt: new Date(), createdByType: "user" })
          .returning({ id: quotes.id });
      const [linked] = await mkQuote(1);
      const [orphan] = await mkQuote(2);
      const [cross] = await mkQuote(3);
      const [msg] = await tx
        .insert(messages)
        .values({ tenantId: A.tenant, conversationId: A.conversation, direction: "outbound", type: "text", status: "sent", author: "user", sentAt: new Date() })
        .returning({ id: messages.id });
      if (!linked || !orphan || !cross || !msg) throw new Error("seed failed");
      const event = (quoteId: string, messageId: string) => ({
        tenantId: A.tenant,
        actorType: "user" as const,
        actorId: A.user,
        entity: "quote",
        entityId: quoteId,
        action: "quote.sent",
        diff: { messageId },
      });
      await tx.insert(auditEvents).values([event(linked.id, msg.id), event(orphan.id, randomUUID()), event(cross.id, B.message)]);
      return { linked: linked.id, orphan: orphan.id, cross: cross.id, message: msg.id };
    });
    const linkOf = (quoteId: string) => migrator.db.select({ messageId: quoteSends.messageId }).from(quoteSends).where(eq(quoteSends.quoteId, quoteId));

    expect(await linkOf(legacy.linked)).toEqual([]);
    await migrator.db.execute(sql.raw(backfill));
    expect(await linkOf(legacy.linked)).toEqual([{ messageId: legacy.message }]);
    await migrator.db.execute(sql.raw(backfill));
    expect(await linkOf(legacy.linked)).toEqual([{ messageId: legacy.message }]);
    expect(await linkOf(legacy.orphan)).toEqual([]);
    expect(await linkOf(legacy.cross)).toEqual([]);
  });

  it("removes the link with the message but keeps the review", async () => {
    await migrator.db.delete(messages).where(eq(messages.id, A.message));
    expect(await migrator.db.select({ id: quoteSends.id }).from(quoteSends).where(eq(quoteSends.quoteId, A.quote))).toEqual([]);
    const [review] = await migrator.db.select({ messageId: quoteUnansweredReviews.messageId }).from(quoteUnansweredReviews).where(eq(quoteUnansweredReviews.id, A.review));
    expect(review?.messageId).toBe(A.message);
  });
});
