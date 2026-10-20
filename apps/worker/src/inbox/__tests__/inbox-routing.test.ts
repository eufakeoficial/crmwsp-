import { randomUUID } from "node:crypto";
import {
  contacts,
  conversationReminders,
  conversations,
  followUps,
  memberships,
  notifications,
  tenants,
  users,
  withTenant,
  type DbHandle,
} from "@crmwsp/db";
import { GupshupProvider } from "@crmwsp/whatsapp";
import { and, eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPgFollowUpStore } from "../../followups/pg-store.js";
import { processIngestMessage, type EventPublisher } from "../../processors.js";
import { APP_URL, MIGRATOR_URL, createDb, dropTenants, hasEnv, ingest, seedTenants, textPayload, type SeedTenant } from "../../__tests__/helpers.js";
import { runReminderTick } from "../reminders.js";

describe.skipIf(!hasEnv)("inbox v2 routing, pause and reminders (Postgres)", () => {
  let migrator: DbHandle;
  let app: DbHandle;
  let A: SeedTenant;
  let deps: { db: DbHandle["db"]; provider: GupshupProvider; publisher: EventPublisher };
  const suffix = randomUUID().slice(0, 8);
  const agents: string[] = [];

  const setInbox = (inbox: Record<string, unknown>) =>
    migrator.db
      .update(tenants)
      .set({ settings: sql`${tenants.settings} || jsonb_build_object('inbox', ${JSON.stringify(inbox)}::jsonb)` })
      .where(eq(tenants.id, A.tenantId));
  const receive = async (phone: string, text = "Hola") => {
    const extId = `wamid-${randomUUID()}`;
    const eventId = await ingest(app, A.token, `msg:${extId}`, textPayload(extId, phone, text));
    return processIngestMessage(deps, { eventId, tenantId: A.tenantId });
  };
  const conv = async (id: string) =>
    (await withTenant(app.db, A.tenantId, (tx) => tx.select().from(conversations).where(eq(conversations.id, id))))[0]!;

  beforeAll(async () => {
    migrator = createDb(MIGRATOR_URL as string, { max: 2 });
    app = createDb(APP_URL as string, { max: 4 });
    [A] = (await seedTenants(migrator, 1)) as [SeedTenant];
    for (const k of ["x", "y"]) {
      const [u] = await migrator.db
        .insert(users)
        .values({ email: `rr-${k}-${suffix}@example.test`, name: k })
        .returning({ id: users.id });
      await migrator.db.insert(memberships).values({ tenantId: A.tenantId, userId: u!.id, role: "agent" });
      agents.push(u!.id);
    }
    deps = { db: app.db, provider: new GupshupProvider(), publisher: { publish: async () => 0 } };
  });

  afterAll(async () => {
    if (migrator) {
      await dropTenants(migrator, [A?.tenantId].filter((x): x is string => Boolean(x)));
      if (agents.length) await migrator.db.delete(users).where(inArray(users.id, agents));
      await migrator.close();
    }
    await app?.close();
  });

  it("new conversations open for a human and are round-robin assigned to the least loaded agent", async () => {
    await setInbox({ autoAssign: "round_robin" });
    const r1 = await receive("5491100000101");
    const r2 = await receive("5491100000102");
    const c1 = await conv(r1.conversationId);
    const c2 = await conv(r2.conversationId);
    expect(c1.inboxStatus).toBe("open");
    expect(c1.assignedAt).not.toBeNull();
    expect(new Set([c1.assignedUserId, c2.assignedUserId])).toEqual(new Set(agents));
  });

  it("respects maxOpenPerAgent", async () => {
    await setInbox({ autoAssign: "round_robin", maxOpenPerAgent: 1 });
    const r = await receive("5491100000103");
    expect((await conv(r.conversationId)).assignedUserId).toBeNull();
  });

  it("reopens a closed conversation on inbound only when configured", async () => {
    await setInbox({ autoAssign: "off", reopenOnInbound: false });
    const r = await receive("5491100000104");
    await migrator.db.update(conversations).set({ inboxStatus: "closed", closedAt: new Date() }).where(eq(conversations.id, r.conversationId));
    await receive("5491100000104", "otra vez");
    expect((await conv(r.conversationId)).inboxStatus).toBe("closed");
    await setInbox({ autoAssign: "off", reopenOnInbound: true });
    await receive("5491100000104", "hola?");
    const c = await conv(r.conversationId);
    expect(c.inboxStatus).toBe("open");
    expect(c.closedAt).toBeNull();
  });

  it("an AI-owned conversation (auto, unassigned) stays closed on inbound", async () => {
    const r = await receive("5491100000105");
    await migrator.db
      .update(conversations)
      .set({ aiMode: "auto", inboxStatus: "closed" })
      .where(eq(conversations.id, r.conversationId));
    await receive("5491100000105", "sigo");
    expect((await conv(r.conversationId)).inboxStatus).toBe("closed");
  });

  it("a resolved conversation reopened by the contact goes back to the same agent", async () => {
    await setInbox({ autoAssign: "off" });
    const r = await receive("5491100000106");
    await migrator.db
      .update(conversations)
      .set({ assignedUserId: agents[1]!, status: "resolved", inboxStatus: "closed" })
      .where(eq(conversations.id, r.conversationId));
    const again = await receive("5491100000106", "volví");
    expect(again.conversationId).not.toBe(r.conversationId);
    const c = await conv(again.conversationId);
    expect(c).toMatchObject({ assignedUserId: agents[1], inboxStatus: "open" });
  });

  it("paused contacts defer their scheduled follow-ups", async () => {
    const r = await receive("5491100000107");
    const [f] = await migrator.db
      .insert(followUps)
      .values({
        tenantId: A.tenantId,
        conversationId: r.conversationId,
        rule: "manual",
        reason: "test",
        messageBody: "¿Seguimos?",
        scheduledAt: new Date(Date.now() - 1000),
        status: "scheduled",
      })
      .returning({ id: followUps.id });
    const [cv] = await migrator.db.select({ contactId: conversations.contactId }).from(conversations).where(eq(conversations.id, r.conversationId));
    await migrator.db.update(contacts).set({ automationsPausedUntil: new Date(Date.now() + 3_600_000) }).where(eq(contacts.id, cv!.contactId));
    const due = await withTenant(app.db, A.tenantId, (tx) => createPgFollowUpStore(tx, A.tenantId).lockDue(new Date(), 50));
    expect(due.map((d) => d.id)).not.toContain(f!.id);
    await migrator.db.update(contacts).set({ automationsPausedUntil: null }).where(eq(contacts.id, cv!.contactId));
    const due2 = await withTenant(app.db, A.tenantId, (tx) => createPgFollowUpStore(tx, A.tenantId).lockDue(new Date(), 50));
    expect(due2.map((d) => d.id)).toContain(f!.id);
  });

  it("the reminder tick creates one notification per due reminder (idempotent)", async () => {
    const r = await receive("5491100000108");
    const [rem] = await migrator.db
      .insert(conversationReminders)
      .values({ tenantId: A.tenantId, conversationId: r.conversationId, userId: agents[0]!, remindAt: new Date(Date.now() - 1000), note: "llamar" })
      .returning({ id: conversationReminders.id });
    await migrator.db
      .insert(conversationReminders)
      .values({ tenantId: A.tenantId, conversationId: r.conversationId, userId: agents[0]!, remindAt: new Date(Date.now() + 3_600_000) });
    const first = await runReminderTick(app.db, new Date());
    expect(first.notified).toBeGreaterThanOrEqual(1);
    await runReminderTick(app.db, new Date());
    const rows = await withTenant(app.db, A.tenantId, (tx) =>
      tx.select().from(notifications).where(and(eq(notifications.kind, "reminder"), eq(notifications.entityId, rem!.id))),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ conversationId: r.conversationId, body: "llamar" });
    const [done] = await withTenant(app.db, A.tenantId, (tx) =>
      tx.select().from(conversationReminders).where(eq(conversationReminders.id, rem!.id)),
    );
    expect(done?.notifiedAt).not.toBeNull();
  });
});
