import { randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type DbHandle } from "../client.js";
import { runMigrations } from "../migrate.js";
import {
  cannedResponses,
  channelConnections,
  contacts,
  conversationNotes,
  conversationReminders,
  conversations,
  memberships,
  notifications,
  tags,
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
  conversation: string;
  note: string;
  reminder: string;
  tag: string;
  canned: string;
}

describe.skipIf(!hasDb)("inbox v2 tables RLS with the app role", () => {
  let migrator: DbHandle;
  let app: DbHandle;
  const suffix = randomUUID().slice(0, 8);
  let A: Seed;
  let B: Seed;

  async function seed(label: string): Promise<Seed> {
    return dangerouslyWithoutTenant(migrator.db, async (tx) => {
      const [t] = await tx
        .insert(tenants)
        .values({ slug: `inbox2-${label}-${suffix}`, name: `Tenant ${label}` })
        .returning({ id: tenants.id });
      const [u] = await tx
        .insert(users)
        .values({ email: `inbox2-${label}-${suffix}@example.test`, name: label })
        .returning({ id: users.id });
      if (!t || !u) throw new Error("seed failed");
      await tx.insert(memberships).values({ tenantId: t.id, userId: u.id, role: "owner" });
      const [c] = await tx
        .insert(channelConnections)
        .values({ tenantId: t.id, provider: "gupshup", phoneE164: "+34600000001", webhookToken: `tok-${randomUUID()}`, status: "active" })
        .returning({ id: channelConnections.id });
      const [ct] = await tx
        .insert(contacts)
        .values({ tenantId: t.id, phoneE164: "+34611111111", name: "Cli", tags: ["vip"] })
        .returning({ id: contacts.id });
      if (!c || !ct) throw new Error("seed failed");
      const [cv] = await tx
        .insert(conversations)
        .values({ tenantId: t.id, contactId: ct.id, channelConnectionId: c.id })
        .returning({ id: conversations.id });
      if (!cv) throw new Error("seed failed");
      const [n] = await tx
        .insert(conversationNotes)
        .values({ tenantId: t.id, conversationId: cv.id, authorId: u.id, body: `note ${label}` })
        .returning({ id: conversationNotes.id });
      const [r] = await tx
        .insert(conversationReminders)
        .values({ tenantId: t.id, conversationId: cv.id, userId: u.id, remindAt: new Date(Date.now() - 60_000) })
        .returning({ id: conversationReminders.id });
      const [tg] = await tx
        .insert(tags)
        .values({ tenantId: t.id, name: "vip", emoji: "⭐", color: "#ff0000" })
        .returning({ id: tags.id });
      const [cr] = await tx
        .insert(cannedResponses)
        .values({ tenantId: t.id, title: "Hola", body: "Hola!", shortcut: "hola", createdBy: u.id })
        .returning({ id: cannedResponses.id });
      if (!n || !r || !tg || !cr) throw new Error("seed failed");
      return { tenant: t.id, user: u.id, conversation: cv.id, note: n.id, reminder: r.id, tag: tg.id, canned: cr.id };
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
    { name: "conversation_notes", table: conversationNotes, key: "note" },
    { name: "conversation_reminders", table: conversationReminders, key: "reminder" },
    { name: "tags", table: tags, key: "tag" },
    { name: "canned_responses", table: cannedResponses, key: "canned" },
  ] as const;

  for (const { name, table, key } of tables) {
    it(`${name}: tenant A only sees its own rows; no tenant sees nothing`, async () => {
      const rows = await withTenant(app.db, A.tenant, (tx) => tx.select({ id: table.id }).from(table));
      expect(rows.map((r) => r.id)).toEqual([A[key]]);
      expect(await app.db.select({ id: table.id }).from(table)).toHaveLength(0);
    });

    it(`${name}: tenant A cannot update nor delete B's rows`, async () => {
      const upd = await withTenant(app.db, A.tenant, (tx) =>
        tx.update(table).set({ createdAt: new Date() }).where(eq(table.id, B[key])).returning({ id: table.id }),
      );
      expect(upd).toHaveLength(0);
      const del = await withTenant(app.db, A.tenant, (tx) => tx.delete(table).where(eq(table.id, B[key])).returning({ id: table.id }));
      expect(del).toHaveLength(0);
    });
  }

  it("rejects inserts into another tenant and cross-tenant conversation links", async () => {
    const foreignTenant = await settle(
      withTenant(app.db, A.tenant, (tx) => tx.insert(tags).values({ tenantId: B.tenant, name: "x" })),
    );
    expect(foreignTenant).toBeInstanceOf(Error);
    // Composite FK (tenant_id, conversation_id): A cannot attach a note to B's conversation.
    const crossNote = await settle(
      withTenant(app.db, A.tenant, (tx) =>
        tx.insert(conversationNotes).values({ tenantId: A.tenant, conversationId: B.conversation, authorId: A.user, body: "x" }),
      ),
    );
    expect(crossNote).toBeInstanceOf(Error);
    const crossReminder = await settle(
      withTenant(app.db, A.tenant, (tx) =>
        tx.insert(conversationReminders).values({ tenantId: A.tenant, conversationId: B.conversation, userId: A.user, remindAt: new Date() }),
      ),
    );
    expect(crossReminder).toBeInstanceOf(Error);
  });

  it("reminder_tenant_ids() lists tenants with due reminders to the app role", async () => {
    const rows = await app.db.execute<{ tenant_id: string }>(sql`select tenant_id from reminder_tenant_ids()`);
    const ids = rows.map((r) => r.tenant_id);
    expect(ids).toContain(A.tenant);
    expect(ids).toContain(B.tenant);
  });

  it("accepts the reminder notification kind and the inbox columns", async () => {
    const [n] = await withTenant(app.db, A.tenant, (tx) =>
      tx
        .insert(notifications)
        .values({ tenantId: A.tenant, kind: "reminder", title: "r", dedupeKey: `reminder:${A.reminder}` })
        .returning({ id: notifications.id }),
    );
    expect(n?.id).toBeTruthy();
    const [cv] = await withTenant(app.db, A.tenant, (tx) =>
      tx
        .update(conversations)
        .set({ inboxStatus: "closed", markedUnread: true, closedAt: new Date() })
        .where(eq(conversations.id, A.conversation))
        .returning({ inboxStatus: conversations.inboxStatus }),
    );
    expect(cv?.inboxStatus).toBe("closed");
    const bad = await settle(
      withTenant(app.db, A.tenant, (tx) =>
        tx.execute(sql`update conversations set inbox_status = 'archived' where id = ${A.conversation}`),
      ),
    );
    expect(bad).toBeInstanceOf(Error);
  });
});
