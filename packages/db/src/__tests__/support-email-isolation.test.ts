import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type DbHandle } from "../client.js";
import { runMigrations } from "../migrate.js";
import { supportTickets, tenants, users } from "../schema/index.js";
import { dangerouslyWithoutTenant, withTenant } from "../with-tenant.js";

const MIGRATOR_URL = process.env.DATABASE_URL_MIGRATOR;
const APP_URL = process.env.DATABASE_URL;
const hasDb = Boolean(MIGRATOR_URL && APP_URL);

const settle = <T>(p: Promise<T>): Promise<unknown> =>
  p.then(
    () => undefined,
    (err: unknown) => err,
  );

interface IngestRow {
  ticket_id: string | null;
  tenant_id: string | null;
  created: boolean;
  outcome: string;
}

describe.skipIf(!hasDb)("support email inbox (0075): external tickets, dedupe and platform functions", () => {
  let migrator: DbHandle;
  let app: DbHandle;
  const suffix = randomUUID().slice(0, 8);
  const s = { admin: "", user: "", A: "", B: "" };
  const userEmail = `mail-user-${suffix}@example.test`;
  const stranger = `stranger-${suffix}@example.test`;

  const ingest = async (resendId: string, from: string, subject: string, extra: { messageId?: string; refs?: string[] } = {}) => {
    const rows = await app.sql<IngestRow[]>`
      select ticket_id, tenant_id, created, outcome from public.support_email_ingest(
        ${resendId}, ${extra.messageId ?? `<${resendId}@mail.test>`}, ${extra.refs ?? []}::text[], ${from}, ${"Remitente"},
        ${["contacto@vendemas.chat"]}::text[], ${subject}, ${subject.toLowerCase()}, ${null}::integer, ${"Hola"}, ${null},
        ${"[]"}::jsonb, ${null})`;
    return rows[0]!;
  };

  beforeAll(async () => {
    await runMigrations(MIGRATOR_URL as string);
    migrator = createDb(MIGRATOR_URL as string, { max: 1 });
    app = createDb(APP_URL as string, { max: 1 });
    await dangerouslyWithoutTenant(migrator.db, async (tx) => {
      const [a, u] = await tx
        .insert(users)
        .values([
          { email: `mail-admin-${suffix}@example.test`, name: "Soporte" },
          { email: userEmail, name: "Ana" },
        ])
        .returning({ id: users.id });
      s.admin = a!.id;
      s.user = u!.id;
      const [ta, tb] = await tx
        .insert(tenants)
        .values([
          { slug: `mail-a-${suffix}`, name: `Mail A ${suffix}` },
          { slug: `mail-b-${suffix}`, name: `Mail B ${suffix}` },
        ])
        .returning({ id: tenants.id });
      s.A = ta!.id;
      s.B = tb!.id;
    });
    await migrator.sql`insert into platform_admins (user_id) values (${s.admin})`;
    await migrator.sql`insert into memberships (tenant_id, user_id, role) values (${s.A}, ${s.user}, 'owner')`;
  });

  afterAll(async () => {
    if (migrator) await migrator.sql`delete from support_tickets where contact_email in (${userEmail}, ${stranger})`;
    if (migrator) await migrator.sql`delete from inbound_events where dedupe_key like ${`resend:${suffix}%`}`;
    if (migrator) await migrator.sql`delete from platform_audit_events where actor_id = ${s.admin}`;
    if (migrator) await migrator.sql`delete from platform_admins where user_id = ${s.admin}`;
    if (migrator) await migrator.sql`delete from tenants where id in (${s.A}, ${s.B})`;
    if (migrator) await migrator.sql`delete from users where id in (${s.admin}, ${s.user})`;
    await migrator?.close();
    await app?.close();
  });

  it("dedupes resend events by dedupe_key", async () => {
    const key = `resend:${suffix}-evt`;
    const [first] = await app.sql<{ inserted: boolean; event_id: string }[]>`select * from public.ingest_resend_event(${key}, ${'{"a":1}'}::jsonb)`;
    const [second] = await app.sql<{ inserted: boolean; event_id: string }[]>`select * from public.ingest_resend_event(${key}, ${'{"a":1}'}::jsonb)`;
    expect(first!.inserted).toBe(true);
    expect(second!.inserted).toBe(false);
    expect(second!.event_id).toBe(first!.event_id);
  });

  it("creates an external ticket for unknown senders that no tenant can see", async () => {
    const r = await ingest(`${suffix}-ext`, stranger, "Consulta de precios");
    expect(r.outcome).toBe("stored");
    expect(r.tenant_id).toBeNull();
    for (const tenant of [s.A, s.B]) {
      const rows = await withTenant(app.db, tenant, (tx) => tx.select({ id: supportTickets.id }).from(supportTickets));
      expect(rows.map((x) => x.id)).not.toContain(r.ticket_id);
    }
    const list = await app.sql<{ ticket_id: string }[]>`select ticket_id from public.platform_email_list(${s.admin}, 'inbox')`;
    expect(list.map((x) => x.ticket_id)).toContain(r.ticket_id);
  });

  it("puts mail from a known user under that user's tenant only", async () => {
    const r = await ingest(`${suffix}-usr`, userEmail, "No me llegan mensajes");
    expect(r.tenant_id).toBe(s.A);
    const inB = await withTenant(app.db, s.B, (tx) => tx.select({ id: supportTickets.id }).from(supportTickets));
    expect(inB.map((x) => x.id)).not.toContain(r.ticket_id);
  });

  it("is idempotent per resend email id and threads by references", async () => {
    const first = await ingest(`${suffix}-thr`, stranger, "Hilo", { messageId: `<root-${suffix}@x>` });
    expect((await ingest(`${suffix}-thr`, stranger, "Hilo")).outcome).toBe("duplicate");
    const reply = await ingest(`${suffix}-thr2`, stranger, "otro asunto", { refs: [`<root-${suffix}@x>`] });
    expect(reply.ticket_id).toBe(first.ticket_id);
    expect(reply.created).toBe(false);
  });

  it("refuses the app role from inserting tenant-less tickets", async () => {
    const err = await settle(
      withTenant(app.db, s.A, (tx) =>
        tx.insert(supportTickets).values({ tenantId: null, channel: "email", contactEmail: stranger, subject: "x", category: "other" }),
      ),
    );
    expect(err).toBeInstanceOf(Error);
  });

  it("platform email functions reject non-admins", async () => {
    const err = await settle(app.sql`select * from public.platform_email_list(${s.user}, 'inbox')`);
    expect(err).toBeInstanceOf(Error);
  });
});
