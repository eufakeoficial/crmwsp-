import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type DbHandle } from "../client.js";
import { runMigrations } from "../migrate.js";
import { users } from "../schema/index.js";
import { dangerouslyWithoutTenant } from "../with-tenant.js";

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
const h = (c: string) => c.repeat(64);

describe.skipIf(!hasDb)("policy monitor (0079)", () => {
  let migrator: DbHandle;
  let app: DbHandle;
  const suffix = randomUUID().slice(0, 8).replace(/-/g, "");
  const source = `test_${suffix}`;
  let admin = "";

  beforeAll(async () => {
    await runMigrations(MIGRATOR_URL as string);
    migrator = createDb(MIGRATOR_URL as string, { max: 1 });
    app = createDb(APP_URL as string, { max: 1 });
    await dangerouslyWithoutTenant(migrator.db, async (tx) => {
      const [u] = await tx.insert(users).values({ email: `pm-${suffix}@example.test`, name: "Admin" }).returning({ id: users.id });
      admin = u!.id;
    });
    await migrator.sql`insert into platform_admins (user_id) values (${admin})`;
  });

  afterAll(async () => {
    if (migrator) {
      await migrator.sql`delete from policy_changes where source_key = ${source}`;
      await migrator.sql`delete from policy_snapshots where source_key = ${source}`;
      if (admin) await dangerouslyWithoutTenant(migrator.db, (tx) => tx.delete(users).where(eq(users.id, admin)));
      await migrator.close();
    }
    if (app) await app.close();
  });

  it("the app role cannot touch the tables directly", async () => {
    expect(pgCode(await settle(app.sql`select * from public.policy_snapshots`))).toBe("42501");
    expect(pgCode(await settle(app.sql`select * from public.policy_changes`))).toBe("42501");
  });

  it("records a first snapshot, ignores the same hash, and opens a change on a new hash", async () => {
    const url = "https://developers.facebook.com/x.md";
    const first = await app.sql<{ id: string | null }[]>`select public.policy_monitor_record(${source}, ${url}, ${h("a")}, 'uno', null, '', 0, 0) as id`;
    expect(first[0]?.id).toBeNull();
    const same = await app.sql<{ id: string | null }[]>`select public.policy_monitor_record(${source}, ${url}, ${h("a")}, 'uno', null, '', 0, 0) as id`;
    expect(same[0]?.id).toBeNull();
    const changed = await app.sql<{ id: string | null }[]>`select public.policy_monitor_record(${source}, ${url}, ${h("b")}, 'dos', null, '+ dos', 1, 1) as id`;
    const id = changed[0]?.id;
    expect(id).toBeTruthy();

    expect(pgCode(await settle(app.sql`select * from public.platform_policy_change_list(${randomUUID()}, null)`))).toBe("42501");
    const list = await app.sql<{ id: string }[]>`select id from public.platform_policy_change_list(${admin}, 'pending')`;
    expect(list.map((r) => r.id)).toContain(id);
    await app.sql`select public.platform_policy_change_review(${admin}, ${id!}, 'sin impacto', null)`;
    expect(pgCode(await settle(app.sql`select public.platform_policy_change_review(${admin}, ${id!}, null, null)`))).toBe("55000");
    const audit = await migrator.sql<{ n: number }[]>`select count(*)::int as n from platform_audit_events where action = 'policy_change.reviewed' and diff->>'changeId' = ${id!}`;
    expect(audit[0]?.n).toBe(1);
  });

  it("rejects non-https urls and bad hashes", async () => {
    expect(pgCode(await settle(app.sql`select public.policy_monitor_record(${source}, 'http://x', ${h("c")}, 't', null, '', 0, 0)`))).toBe("22023");
    expect(pgCode(await settle(app.sql`select public.policy_monitor_record(${source}, 'https://x', 'zz', 't', null, '', 0, 0)`))).toBe("22023");
  });
});
