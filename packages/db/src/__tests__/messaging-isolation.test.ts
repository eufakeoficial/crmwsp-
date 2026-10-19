import { randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type DbHandle } from "../client.js";
import { runMigrations } from "../migrate.js";
import {
  attachments,
  auditEvents,
  channelConnections,
  contacts,
  conversations,
  inboundEvents,
  memberships,
  messages,
  tenants,
  users,
} from "../schema/index.js";
import { dangerouslyWithoutTenant, withTenant } from "../with-tenant.js";

const MIGRATOR_URL = process.env.DATABASE_URL_MIGRATOR;
const APP_URL = process.env.DATABASE_URL;
const hasDb = Boolean(MIGRATOR_URL && APP_URL);

type PgCause = { code?: string; message?: string };
const pgCause = (err: unknown): PgCause | undefined =>
  (err as Error & { cause?: PgCause } | undefined)?.cause ?? (err as PgCause | undefined);
const settle = <T>(p: Promise<T>): Promise<unknown> =>
  p.then(
    () => undefined,
    (err: unknown) => err,
  );

interface Seed {
  tenant: string;
  user: string;
  conn: string;
  token: string;
  contact: string;
  conversation: string;
  message: string;
  attachment: string;
  audit: string;
}

describe.skipIf(!hasDb)("messaging tables + users RLS with the app role", () => {
  let migrator: DbHandle;
  let app: DbHandle;
  const suffix = randomUUID().slice(0, 8);
  let A: Seed;
  let B: Seed;

  async function seed(label: string): Promise<Seed> {
    return dangerouslyWithoutTenant(migrator.db, async (tx) => {
      const [t] = await tx
        .insert(tenants)
        .values({ slug: `msg-${label}-${suffix}`, name: `Tenant ${label}` })
        .returning({ id: tenants.id });
      const [u] = await tx
        .insert(users)
        .values({ email: `msg-${label}-${suffix}@example.test`, name: label })
        .returning({ id: users.id });
      if (!t || !u) throw new Error("seed failed");
      await tx.insert(memberships).values({ tenantId: t.id, userId: u.id, role: "owner" });
      const token = `tok-${label}-${randomUUID()}`;
      const [c] = await tx
        .insert(channelConnections)
        .values({ tenantId: t.id, provider: "gupshup", phoneE164: "+34600000001", webhookToken: token, status: "active" })
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
      const [m] = await tx
        .insert(messages)
        .values({
          tenantId: t.id,
          conversationId: cv.id,
          direction: "inbound",
          type: "text",
          body: "hola",
          externalId: `wamid-${label}-${suffix}`,
          status: "received",
          author: "contact",
        })
        .returning({ id: messages.id });
      if (!m) throw new Error("seed failed");
      const [at] = await tx
        .insert(attachments)
        .values({ tenantId: t.id, messageId: m.id, storageKey: "k", mimeType: "image/jpeg", sizeBytes: 10 })
        .returning({ id: attachments.id });
      const [au] = await tx
        .insert(auditEvents)
        .values({ tenantId: t.id, actorType: "system", entity: "contact", entityId: ct.id, action: "create" })
        .returning({ id: auditEvents.id });
      if (!at || !au) throw new Error("seed failed");
      return {
        tenant: t.id,
        user: u.id,
        conn: c.id,
        token,
        contact: ct.id,
        conversation: cv.id,
        message: m.id,
        attachment: at.id,
        audit: au.id,
      };
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
      const uids = [A?.user, B?.user].filter((x): x is string => Boolean(x));
      if (ids.length) await migrator.db.delete(tenants).where(inArray(tenants.id, ids));
      if (uids.length) await migrator.db.delete(users).where(inArray(users.id, uids));
      await migrator.close();
    }
    if (app) await app.close();
  });

  const tables = [
    { name: "channel_connections", table: channelConnections, key: "conn" },
    { name: "contacts", table: contacts, key: "contact" },
    { name: "conversations", table: conversations, key: "conversation" },
    { name: "messages", table: messages, key: "message" },
    { name: "attachments", table: attachments, key: "attachment" },
    { name: "audit_events", table: auditEvents, key: "audit" },
  ] as const;

  for (const { name, table, key } of tables) {
    it(`${name}: tenant A only sees its rows and cannot modify B's`, async () => {
      const rows = await withTenant(app.db, A.tenant, (tx) =>
        tx.select({ id: table.id, tenantId: table.tenantId }).from(table),
      );
      expect(rows.map((r) => r.id)).toContain(A[key]);
      expect(rows.every((r) => r.tenantId === A.tenant)).toBe(true);

      const updated = await withTenant(app.db, A.tenant, (tx) =>
        tx.update(table).set({ tenantId: A.tenant }).where(eq(table.id, B[key])).returning({ id: table.id }),
      ).catch((err: unknown) => err);
      // audit_events has no UPDATE policy at all; others filter to 0 rows.
      if (Array.isArray(updated)) expect(updated).toHaveLength(0);
      const deleted = await withTenant(app.db, A.tenant, (tx) =>
        tx.delete(table).where(eq(table.id, B[key])).returning({ id: table.id }),
      ).catch((err: unknown) => err);
      // audit_events: DELETE is not even granted (42501); others filter to 0 rows.
      if (Array.isArray(deleted)) expect(deleted).toHaveLength(0);
      else expect(pgCause(deleted)?.code).toBe("42501");
      const [still] = await migrator.db.select({ t: table.tenantId }).from(table).where(eq(table.id, B[key]));
      expect(still?.t).toBe(B.tenant);
    });
  }

  it("cannot insert rows with another tenant's tenant_id (WITH CHECK)", async () => {
    const inserts = [
      (tx: Parameters<Parameters<typeof withTenant>[2]>[0]) =>
        tx.insert(channelConnections).values({
          tenantId: B.tenant,
          provider: "gupshup",
          phoneE164: "+34999",
          webhookToken: `evil-${randomUUID()}`,
        }),
      (tx: Parameters<Parameters<typeof withTenant>[2]>[0]) =>
        tx.insert(contacts).values({ tenantId: B.tenant, phoneE164: "+34999" }),
      (tx: Parameters<Parameters<typeof withTenant>[2]>[0]) =>
        tx.insert(conversations).values({ tenantId: B.tenant, contactId: B.contact, channelConnectionId: B.conn, status: "resolved" }),
      (tx: Parameters<Parameters<typeof withTenant>[2]>[0]) =>
        tx.insert(messages).values({
          tenantId: B.tenant,
          conversationId: B.conversation,
          direction: "outbound",
          type: "text",
          status: "queued",
          author: "user",
        }),
      (tx: Parameters<Parameters<typeof withTenant>[2]>[0]) =>
        tx.insert(attachments).values({ tenantId: B.tenant, messageId: B.message }),
      (tx: Parameters<Parameters<typeof withTenant>[2]>[0]) =>
        tx.insert(auditEvents).values({ tenantId: B.tenant, actorType: "system", entity: "x", action: "y" }),
      (tx: Parameters<Parameters<typeof withTenant>[2]>[0]) =>
        tx.insert(inboundEvents).values({
          tenantId: A.tenant,
          provider: "gupshup",
          dedupeKey: `direct-${randomUUID()}`,
          payload: {},
          signatureValid: true,
        }),
    ];
    for (const ins of inserts) {
      const err = await settle(withTenant(app.db, A.tenant, ins));
      expect(err).toBeInstanceOf(Error);
      expect(pgCause(err)?.code).toBe("42501");
    }
  });

  it("users: only members of the current tenant are visible", async () => {
    const rows = await withTenant(app.db, A.tenant, (tx) => tx.select({ id: users.id }).from(users));
    expect(rows.map((r) => r.id)).toContain(A.user);
    expect(rows.map((r) => r.id)).not.toContain(B.user);
    const none = await app.db.select({ id: users.id }).from(users);
    expect(none).toHaveLength(0);
  });

  it("users: only the acting user can update itself; no insert/delete", async () => {
    const noUser = await withTenant(app.db, A.tenant, (tx) =>
      tx.update(users).set({ name: "x" }).where(eq(users.id, A.user)).returning({ id: users.id }),
    );
    expect(noUser).toHaveLength(0);
    const own = await withTenant(
      app.db,
      A.tenant,
      (tx) => tx.update(users).set({ name: "A2" }).where(eq(users.id, A.user)).returning({ id: users.id }),
      { userId: A.user },
    );
    expect(own).toHaveLength(1);
    const other = await withTenant(
      app.db,
      A.tenant,
      (tx) => tx.update(users).set({ name: "pwn" }).where(eq(users.id, B.user)).returning({ id: users.id }),
      { userId: B.user },
    );
    expect(other).toHaveLength(0);
    const [b] = await migrator.db.select({ name: users.name }).from(users).where(eq(users.id, B.user));
    expect(b?.name).toBe("b");

    const insErr = await settle(
      withTenant(app.db, A.tenant, (tx) => tx.insert(users).values({ email: `evil-${suffix}@example.test` })),
    );
    expect(pgCause(insErr)?.code).toBe("42501");
    const del = await withTenant(
      app.db,
      A.tenant,
      (tx) => tx.delete(users).where(eq(users.id, A.user)).returning({ id: users.id }),
      { userId: A.user },
    );
    expect(del).toHaveLength(0);
  });

  it("users: the app role cannot change email (system job only)", async () => {
    const err = await settle(
      withTenant(
        app.db,
        A.tenant,
        (tx) => tx.update(users).set({ email: `squat-${suffix}@example.test` }).where(eq(users.id, A.user)),
        { userId: A.user },
      ),
    );
    expect(pgCause(err)?.code).toBe("42501");
  });

  it("app role is not a member of any table owner (owner policies stay out of reach)", async () => {
    const rows = await migrator.sql<{ n: number }[]>`
      select count(*)::int as n from pg_class c
      where c.relname in ('tenants','memberships','users','channel_connections','contacts','conversations',
                          'messages','attachments','audit_events','inbound_events')
        and c.relnamespace = 'public'::regnamespace
        and pg_has_role(${"crmwsp_app"}, c.relowner, 'MEMBER')`;
    expect(rows[0]?.n).toBe(0);
  });

  it("withTenant rejects a non-uuid userId", async () => {
    await expect(withTenant(app.db, A.tenant, async () => undefined, { userId: "nope" })).rejects.toThrow(/uuid/);
  });

  it("audit_events is append-only (no UPDATE/DELETE on own rows)", async () => {
    const ins = await withTenant(app.db, A.tenant, (tx) =>
      tx
        .insert(auditEvents)
        .values({ tenantId: A.tenant, actorType: "user", entity: "contact", action: "update", diff: { a: 1 } })
        .returning({ id: auditEvents.id }),
    );
    expect(ins).toHaveLength(1);
    const upd = await settle(
      withTenant(app.db, A.tenant, (tx) =>
        tx.update(auditEvents).set({ action: "tampered" }).where(eq(auditEvents.id, A.audit)),
      ),
    );
    expect(pgCause(upd)?.code).toBe("42501");
    const del = await settle(withTenant(app.db, A.tenant, (tx) => tx.delete(auditEvents).where(eq(auditEvents.id, A.audit))));
    expect(pgCause(del)?.code).toBe("42501");
    const trunc = await settle(withTenant(app.db, A.tenant, (tx) => tx.execute(sql`truncate audit_events`)));
    expect(pgCause(trunc)?.code).toBe("42501");
    const [row] = await migrator.db.select({ action: auditEvents.action }).from(auditEvents).where(eq(auditEvents.id, A.audit));
    expect(row?.action).toBe("create");
  });

  it("messages rejects a duplicate external_id in the same tenant", async () => {
    const err = await settle(
      withTenant(app.db, A.tenant, (tx) =>
        tx.insert(messages).values({
          tenantId: A.tenant,
          conversationId: A.conversation,
          direction: "inbound",
          type: "text",
          externalId: `wamid-a-${suffix}`,
          status: "received",
          author: "contact",
        }),
      ),
    );
    expect(pgCause(err)?.code).toBe("23505");
  });

  it("conversations: a second unresolved conversation for the same contact+channel fails", async () => {
    const err = await settle(
      withTenant(app.db, A.tenant, (tx) =>
        tx.insert(conversations).values({ tenantId: A.tenant, contactId: A.contact, channelConnectionId: A.conn, status: "pending" }),
      ),
    );
    expect(pgCause(err)?.code).toBe("23505");
    // A resolved one is allowed.
    const ok = await withTenant(app.db, A.tenant, (tx) =>
      tx
        .insert(conversations)
        .values({ tenantId: A.tenant, contactId: A.contact, channelConnectionId: A.conn, status: "resolved" })
        .returning({ id: conversations.id }),
    );
    expect(ok).toHaveLength(1);
  });

  describe("ingest_inbound_event", () => {
    type Row = { event_id: string | null; tenant_id: string; inserted: boolean };
    const ingest = (token: string, dedupe: string, provider = "gupshup") =>
      app.sql<Row[]>`select * from ingest_inbound_event(${provider}::channel_provider, ${token}, ${dedupe}, ${JSON.stringify({ x: 1 })}::jsonb, true)`;

    it("is idempotent and resolves the tenant by webhook_token", async () => {
      const key = `dk-${randomUUID()}`;
      const [first] = await ingest(A.token, key);
      expect(first?.inserted).toBe(true);
      expect(first?.tenant_id).toBe(A.tenant);
      const [second] = await ingest(A.token, key);
      expect(second).toEqual({ event_id: first?.event_id, tenant_id: A.tenant, inserted: false });
      const rows = await migrator.db
        .select({ id: inboundEvents.id, t: inboundEvents.tenantId, c: inboundEvents.channelConnectionId })
        .from(inboundEvents)
        .where(eq(inboundEvents.dedupeKey, key));
      expect(rows).toEqual([{ id: first?.event_id, t: A.tenant, c: A.conn }]);

      const [b] = await ingest(B.token, `dk-${randomUUID()}`);
      expect(b?.tenant_id).toBe(B.tenant);
    });

    it("does not reveal another connection's event on dedupe collision", async () => {
      const key = `dk-${randomUUID()}`;
      await ingest(A.token, key);
      const [res] = await ingest(B.token, key);
      expect(res).toEqual({ event_id: null, tenant_id: B.tenant, inserted: false });
    });

    it("unknown token or wrong provider inserts nothing", async () => {
      const key = `dk-${randomUUID()}`;
      expect(await ingest(`nope-${randomUUID()}`, key)).toHaveLength(0);
      expect(await ingest(A.token, key, "360dialog")).toHaveLength(0);
      const rows = await migrator.db.select().from(inboundEvents).where(eq(inboundEvents.dedupeKey, key));
      expect(rows).toHaveLength(0);
    });

    it("inbound_events visible/updatable only for its tenant; no delete", async () => {
      const [ev] = await ingest(B.token, `dk-${randomUUID()}`);
      const seen = await withTenant(app.db, A.tenant, (tx) =>
        tx.select({ id: inboundEvents.id }).from(inboundEvents).where(eq(inboundEvents.id, ev?.event_id as string)),
      );
      expect(seen).toHaveLength(0);
      const upd = await withTenant(app.db, A.tenant, (tx) =>
        tx
          .update(inboundEvents)
          .set({ processedAt: sql`now()` })
          .where(eq(inboundEvents.id, ev?.event_id as string))
          .returning({ id: inboundEvents.id }),
      );
      expect(upd).toHaveLength(0);
      const own = await withTenant(app.db, B.tenant, (tx) =>
        tx
          .update(inboundEvents)
          .set({ processedAt: sql`now()` })
          .where(eq(inboundEvents.id, ev?.event_id as string))
          .returning({ id: inboundEvents.id }),
      );
      expect(own).toHaveLength(1);
      const del = await settle(
        withTenant(app.db, B.tenant, (tx) => tx.delete(inboundEvents).where(eq(inboundEvents.id, ev?.event_id as string))),
      );
      expect(pgCause(del)?.code).toBe("42501");
      const [still] = await migrator.db.select({ id: inboundEvents.id }).from(inboundEvents).where(eq(inboundEvents.id, ev?.event_id as string));
      expect(still?.id).toBe(ev?.event_id);
    });

    it("rejects payloads larger than 1 MiB without inserting", async () => {
      const key = `dk-${randomUUID()}`;
      const big = JSON.stringify({ x: "a".repeat(1_100_000) });
      const err = await settle(
        app.sql`select * from ingest_inbound_event('gupshup'::channel_provider, ${A.token}, ${key}, ${big}::jsonb, true)`,
      );
      expect(pgCause(err)?.code).toBe("54000");
      expect(pgCause(err)?.message).not.toContain(A.token);
      const rows = await migrator.db.select().from(inboundEvents).where(eq(inboundEvents.dedupeKey, key));
      expect(rows).toHaveLength(0);
    });

    it("does not change the caller's app.tenant_id", async () => {
      const t = await withTenant(app.db, A.tenant, async (tx) => {
        await tx.execute(sql`select * from ingest_inbound_event('gupshup'::channel_provider, ${B.token}, ${`dk-${randomUUID()}`}, '{}'::jsonb, true)`);
        const r = await tx.execute<{ t: string }>(sql`select current_setting('app.tenant_id', true) as t`);
        return r[0]?.t;
      });
      expect(t).toBe(A.tenant);
    });

    it("has a fixed search_path ending in pg_temp", async () => {
      const rows = await migrator.sql<{ cfg: string[] }[]>`
        select proconfig as cfg from pg_proc where proname = 'ingest_inbound_event'`;
      expect(rows[0]?.cfg).toContain("search_path=pg_catalog, public, pg_temp");
    });

    it("PUBLIC cannot execute the function", async () => {
      const rows = await migrator.sql<{ ok: boolean }[]>`
        select has_function_privilege('public', 'ingest_inbound_event(channel_provider,text,text,jsonb,boolean)', 'EXECUTE') as ok`;
      expect(rows[0]?.ok).toBe(false);
    });
  });
});
