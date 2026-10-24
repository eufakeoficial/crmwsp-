import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type DbHandle } from "../client.js";
import { runMigrations } from "../migrate.js";
import { supportMessages, supportTickets, tenants, users } from "../schema/index.js";
import { dangerouslyWithoutTenant, withTenant } from "../with-tenant.js";

const MIGRATOR_URL = process.env.DATABASE_URL_MIGRATOR;
const APP_URL = process.env.DATABASE_URL;
const hasDb = Boolean(MIGRATOR_URL && APP_URL);

const settle = <T>(p: Promise<T>): Promise<unknown> =>
  p.then(
    () => undefined,
    (err: unknown) => err,
  );

describe.skipIf(!hasDb)("support tickets: RLS, column grants and platform functions", () => {
  let migrator: DbHandle;
  let app: DbHandle;
  const suffix = randomUUID().slice(0, 8);
  const s = { admin: "", user: "", A: "", B: "", ticketA: "", ticketB: "" };

  beforeAll(async () => {
    await runMigrations(MIGRATOR_URL as string);
    migrator = createDb(MIGRATOR_URL as string, { max: 1 });
    app = createDb(APP_URL as string, { max: 1 });
    await dangerouslyWithoutTenant(migrator.db, async (tx) => {
      const [a, u] = await tx
        .insert(users)
        .values([
          { email: `sadmin-${suffix}@example.test`, name: "Soporte" },
          { email: `suser-${suffix}@example.test`, name: "Ana" },
        ])
        .returning({ id: users.id });
      s.admin = a!.id;
      s.user = u!.id;
      const [ta, tb] = await tx
        .insert(tenants)
        .values([
          { slug: `sup-a-${suffix}`, name: `Sup A ${suffix}` },
          { slug: `sup-b-${suffix}`, name: `Sup B ${suffix}` },
        ])
        .returning({ id: tenants.id });
      s.A = ta!.id;
      s.B = tb!.id;
    });
    await migrator.sql`insert into platform_admins (user_id) values (${s.admin})`;
    for (const tenant of [s.A, s.B]) {
      const id = await withTenant(app.db, tenant, async (tx) => {
        const [t] = await tx
          .insert(supportTickets)
          .values({ tenantId: tenant, subject: "No llegan mensajes", category: "whatsapp", createdBy: s.user })
          .returning({ id: supportTickets.id });
        await tx.insert(supportMessages).values({ tenantId: tenant, ticketId: t!.id, authorType: "tenant_user", authorUserId: s.user, body: "Ayuda" });
        return t!.id;
      });
      if (tenant === s.A) s.ticketA = id;
      else s.ticketB = id;
    }
  });

  afterAll(async () => {
    if (migrator) {
      await dangerouslyWithoutTenant(migrator.db, async (tx) => {
        await tx.delete(tenants).where(inArray(tenants.id, [s.A, s.B].filter(Boolean)));
        await tx.delete(users).where(inArray(users.id, [s.admin, s.user].filter(Boolean)));
      });
      await migrator.sql`delete from support_canned_responses where title like ${`%${suffix}%`}`;
      await migrator.close();
    }
    if (app) await app.close();
  });

  it("tenant A only sees its own tickets and messages; nothing without a tenant", async () => {
    const t = await withTenant(app.db, s.A, (tx) => tx.select({ id: supportTickets.id }).from(supportTickets));
    expect(t.map((r) => r.id)).toEqual([s.ticketA]);
    const m = await withTenant(app.db, s.A, (tx) => tx.select({ t: supportMessages.ticketId }).from(supportMessages));
    expect(m.every((r) => r.t === s.ticketA)).toBe(true);
    expect(await app.db.select({ id: supportTickets.id }).from(supportTickets)).toHaveLength(0);
    expect(await app.db.select({ id: supportMessages.id }).from(supportMessages)).toHaveLength(0);
  });

  it("tenant A cannot update, delete or reply to B's ticket", async () => {
    const up = await withTenant(app.db, s.A, (tx) => tx.update(supportTickets).set({ status: "resolved", resolvedAt: new Date() }).where(eq(supportTickets.id, s.ticketB)).returning({ id: supportTickets.id }));
    expect(up).toHaveLength(0);
    expect(await settle(withTenant(app.db, s.A, (tx) => tx.delete(supportTickets).where(eq(supportTickets.id, s.ticketB))))).toBeInstanceOf(Error);
    const cross = withTenant(app.db, s.A, (tx) => tx.insert(supportMessages).values({ tenantId: s.A, ticketId: s.ticketB, authorType: "tenant_user", body: "x" }));
    expect(await settle(cross)).toBeInstanceOf(Error);
    const forB = withTenant(app.db, s.A, (tx) => tx.insert(supportMessages).values({ tenantId: s.B, ticketId: s.ticketB, authorType: "tenant_user", body: "x" }));
    expect(await settle(forB)).toBeInstanceOf(Error);
  });

  it("the app role cannot write admin messages, internal notes or the assignee", async () => {
    const asAdmin = withTenant(app.db, s.A, (tx) => tx.insert(supportMessages).values({ tenantId: s.A, ticketId: s.ticketA, authorType: "platform_admin", body: "x" }));
    expect(await settle(asAdmin)).toBeInstanceOf(Error);
    const internal = withTenant(app.db, s.A, (tx) => tx.insert(supportMessages).values({ tenantId: s.A, ticketId: s.ticketA, authorType: "tenant_user", body: "x", internal: true }));
    expect(await settle(internal)).toBeInstanceOf(Error);
    const assign = withTenant(app.db, s.A, (tx) => tx.update(supportTickets).set({ assigneeId: s.user }).where(eq(supportTickets.id, s.ticketA)));
    expect(await settle(assign)).toBeInstanceOf(Error);
    const priority = withTenant(app.db, s.A, (tx) => tx.update(supportTickets).set({ priority: "urgent" }).where(eq(supportTickets.id, s.ticketA)));
    expect(await settle(priority)).toBeInstanceOf(Error);
  });

  it("the app role has no access to canned responses", async () => {
    expect(await settle(app.sql`select * from public.support_canned_responses limit 1`)).toBeInstanceOf(Error);
  });

  it("platform functions refuse non-admins (42501)", async () => {
    for (const q of [
      app.sql`select * from public.platform_support_ticket_list(${s.user}, null, null, null, null, null)`,
      app.sql`select * from public.platform_support_messages(${s.user}, ${s.ticketA})`,
      app.sql`select * from public.platform_support_reply(${s.user}, ${s.ticketA}, 'x', false, null)`,
      app.sql`select public.platform_support_update(${s.user}, ${s.ticketA}, 'resolved', null, null, null)`,
      app.sql`select * from public.platform_support_canned_list(${s.user})`,
    ]) {
      const err = (await settle(q)) as { code?: string } | undefined;
      expect(err?.code).toBe("42501");
    }
  });

  it("an admin sees tickets across tenants, replies, adds hidden internal notes and is audited", async () => {
    const rows = await app.sql<{ ticket_id: string }[]>`select ticket_id from public.platform_support_ticket_list(${s.admin}, null, null, null, null, null)`;
    const ids = rows.map((r) => r.ticket_id);
    expect(ids).toEqual(expect.arrayContaining([s.ticketA, s.ticketB]));

    await app.sql`select * from public.platform_support_reply(${s.admin}, ${s.ticketA}, 'Hola, lo revisamos', false, null)`;
    await app.sql`select * from public.platform_support_reply(${s.admin}, ${s.ticketA}, 'nota interna', true, null)`;
    const [after] = await withTenant(app.db, s.A, (tx) => tx.select().from(supportTickets).where(eq(supportTickets.id, s.ticketA)));
    expect(after?.status).toBe("waiting_customer");
    expect(after?.tenantUnread).toBe(true);

    const tenantView = await withTenant(app.db, s.A, (tx) => tx.select({ body: supportMessages.body }).from(supportMessages).where(eq(supportMessages.ticketId, s.ticketA)));
    expect(tenantView.map((m) => m.body)).toEqual(expect.arrayContaining(["Ayuda", "Hola, lo revisamos"]));
    expect(tenantView.map((m) => m.body)).not.toContain("nota interna");

    const adminView = await app.sql<{ body: string; internal: boolean }[]>`select body, internal from public.platform_support_messages(${s.admin}, ${s.ticketA})`;
    expect(adminView.find((m) => m.body === "nota interna")?.internal).toBe(true);

    const tenantOfB = await app.sql<{ v: string }[]>`select public.platform_support_update(${s.admin}, ${s.ticketB}, 'resolved', 'high', 'me', null) as v`;
    expect(tenantOfB[0]?.v).toBe(s.B);
    const [b] = await app.sql<{ status: string; assignee_id: string }[]>`select status, assignee_id from public.platform_support_ticket_list(${s.admin}, null, null, null, null, 'me', ${s.ticketB})`;
    expect(b).toMatchObject({ status: "resolved", assignee_id: s.admin });

    const audit = await migrator.sql<{ action: string }[]>`select action from platform_audit_events where actor_id = ${s.admin} and action like 'support.%'`;
    expect(audit.map((r) => r.action)).toEqual(expect.arrayContaining(["support.reply", "support.update"]));
  });

  it("an admin manages canned responses", async () => {
    const [c] = await app.sql<{ canned_id: string }[]>`select canned_id from public.platform_support_canned_upsert(${s.admin}, null, ${`Saludo ${suffix}`}, 'Hola {{nombre}}', null)`;
    expect(c?.canned_id).toBeTruthy();
    await app.sql`select * from public.platform_support_canned_upsert(${s.admin}, ${c!.canned_id}, ${`Saludo ${suffix}`}, 'Hola {{nombre}} de {{negocio}}', null)`;
    const list = await app.sql<{ body: string }[]>`select body from public.platform_support_canned_list(${s.admin}) where canned_id = ${c!.canned_id}`;
    expect(list[0]?.body).toBe("Hola {{nombre}} de {{negocio}}");
    const [del] = await app.sql<{ v: boolean }[]>`select public.platform_support_canned_delete(${s.admin}, ${c!.canned_id}, null) as v`;
    expect(del?.v).toBe(true);
  });
});
