import { createHash, randomBytes, randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type DbHandle } from "../client.js";
import { runMigrations } from "../migrate.js";
import { readPlanUsage } from "../plan-usage.js";
import { memberships, teamInvitations, tenants, users } from "../schema/index.js";
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
const newToken = () => {
  const raw = randomBytes(32);
  return { raw, hash: createHash("sha256").update(raw).digest() };
};
const inDays = (d: number) => new Date(Date.now() + d * 86_400_000);

describe.skipIf(!hasDb)("team_invitations isolation (RLS) and definer functions", () => {
  let migrator: DbHandle;
  let app: DbHandle;
  const suffix = randomUUID().slice(0, 8);
  const A = { tenant: "", invite: "" };
  const B = { tenant: "", invite: "" };
  const userIds: string[] = [];

  async function invite(tenantId: string, email: string, expiresAt = inDays(7)) {
    const t = newToken();
    const [row] = await dangerouslyWithoutTenant(migrator.db, (tx) =>
      tx.insert(teamInvitations).values({ tenantId, email, role: "agent", tokenHash: t.hash, expiresAt }).returning({ id: teamInvitations.id }),
    );
    return { ...t, id: row!.id };
  }

  beforeAll(async () => {
    await runMigrations(MIGRATOR_URL as string);
    migrator = createDb(MIGRATOR_URL as string, { max: 1 });
    app = createDb(APP_URL as string, { max: 1 });
    for (const [s, label] of [
      [A, "a"],
      [B, "b"],
    ] as const) {
      const [t] = await dangerouslyWithoutTenant(migrator.db, (tx) =>
        tx.insert(tenants).values({ slug: `inv-${label}-${suffix}`, name: `INV ${label}` }).returning({ id: tenants.id }),
      );
      s.tenant = t!.id;
      s.invite = (await invite(t!.id, `pending-${label}-${suffix}@example.test`)).id;
    }
  });

  afterAll(async () => {
    if (migrator) {
      const ids = [A.tenant, B.tenant].filter(Boolean);
      await dangerouslyWithoutTenant(migrator.db, async (tx) => {
        if (ids.length) await tx.delete(tenants).where(inArray(tenants.id, ids));
        if (userIds.length) await tx.delete(users).where(inArray(users.id, userIds));
      });
      await migrator.close();
    }
    if (app) await app.close();
  });

  it("selects only the current tenant's invitations", async () => {
    const rows = await withTenant(app.db, A.tenant, (tx) => tx.select({ id: teamInvitations.id }).from(teamInvitations));
    expect(rows).toEqual([{ id: A.invite }]);
  });

  it("cannot update another tenant's invitation, nor insert into it, nor delete at all", async () => {
    const upd = await withTenant(app.db, A.tenant, (tx) =>
      tx.update(teamInvitations).set({ revokedAt: new Date() }).where(eq(teamInvitations.id, B.invite)).returning({ id: teamInvitations.id }),
    );
    expect(upd).toEqual([]);
    const ins = await settle(
      withTenant(app.db, A.tenant, (tx) =>
        tx.insert(teamInvitations).values({ tenantId: B.tenant, email: "x@example.test", role: "agent", tokenHash: newToken().hash, expiresAt: inDays(7) }),
      ),
    );
    expect(pgCode(ins)).toBe("42501");
    const del = await settle(withTenant(app.db, A.tenant, (tx) => tx.delete(teamInvitations).where(eq(teamInvitations.id, A.invite))));
    expect(pgCode(del)).toBe("42501");
  });

  it("rejects owner invitations at the database level", async () => {
    const err = await settle(
      withTenant(app.db, A.tenant, (tx) =>
        tx.insert(teamInvitations).values({ tenantId: A.tenant, email: `own-${suffix}@example.test`, role: "owner", tokenHash: newToken().hash, expiresAt: inDays(7) }),
      ),
    );
    expect(pgCode(err)).toBe("23514");
  });

  it("counts pending invitations as seats", async () => {
    const usage = await withTenant(app.db, A.tenant, readPlanUsage);
    expect(usage.seats).toBe(1);
  });

  it("lookup returns only usable invitations with the minimal row", async () => {
    const ok = await invite(A.tenant, `look-${suffix}@example.test`);
    const rows = await app.sql`select * from public.team_invitation_lookup(${ok.hash})`;
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0]!).sort()).toEqual(["email", "expires_at", "has_account", "role", "tenant_name"]);
    expect(rows[0]).toMatchObject({ tenant_name: "INV a", email: `look-${suffix}@example.test`, role: "agent", has_account: false });
    const expired = await invite(A.tenant, `exp-${suffix}@example.test`, new Date(Date.now() - 1000));
    expect(await app.sql`select * from public.team_invitation_lookup(${expired.hash})`).toHaveLength(0);
    expect(await app.sql`select * from public.team_invitation_lookup(${newToken().hash})`).toHaveLength(0);
    expect(await app.sql`select * from public.team_invitation_lookup(${Buffer.alloc(5)})`).toHaveLength(0);
  });

  it("signup creates the user with the invited email, single use", async () => {
    const email = `new-${suffix}@example.test`;
    const inv = await invite(A.tenant, email);
    const [row] = await app.sql<{ user_id: string; tenant_id: string; role: string }[]>`
      select * from public.team_invitation_signup(${inv.hash}, ${"Nueva"}, ${"scrypt$fake"})`;
    expect(row).toMatchObject({ tenant_id: A.tenant, role: "agent" });
    userIds.push(row!.user_id);
    const [u] = await dangerouslyWithoutTenant(migrator.db, (tx) => tx.select().from(users).where(eq(users.id, row!.user_id)));
    expect(u?.email).toBe(email);
    const again = await settle(app.sql`select * from public.team_invitation_signup(${inv.hash}, ${"X"}, ${"scrypt$fake"})`);
    expect(pgCode(again)).toBe("P0002");
    const reuse = await settle(app.sql`select * from public.team_invitation_accept(${inv.hash}, ${row!.user_id})`);
    expect(pgCode(reuse)).toBe("P0002");
  });

  it("accept rejects a different email and an expired token; accepts the invited user once", async () => {
    const email = `exist-${suffix}@example.test`;
    const [u] = await dangerouslyWithoutTenant(migrator.db, (tx) => tx.insert(users).values({ email }).returning({ id: users.id }));
    const [other] = await dangerouslyWithoutTenant(migrator.db, (tx) =>
      tx.insert(users).values({ email: `other-${suffix}@example.test` }).returning({ id: users.id }),
    );
    userIds.push(u!.id, other!.id);
    const inv = await invite(B.tenant, email);
    expect(pgCode(await settle(app.sql`select * from public.team_invitation_accept(${inv.hash}, ${other!.id})`))).toBe("42501");
    const expired = await invite(B.tenant, `exp2-${suffix}@example.test`, new Date(Date.now() - 1000));
    expect(pgCode(await settle(app.sql`select * from public.team_invitation_accept(${expired.hash}, ${u!.id})`))).toBe("P0002");
    const [ok] = await app.sql`select * from public.team_invitation_accept(${inv.hash}, ${u!.id})`;
    expect(ok).toMatchObject({ tenant_id: B.tenant, role: "agent" });
    const m = await withTenant(app.db, B.tenant, (tx) => tx.select({ userId: memberships.userId }).from(memberships));
    expect(m.map((r) => r.userId)).toContain(u!.id);
    // Accepting tenant B's invitation never grants membership in A.
    const inA = await withTenant(app.db, A.tenant, (tx) => tx.select({ userId: memberships.userId }).from(memberships));
    expect(inA.map((r) => r.userId)).not.toContain(u!.id);
    expect(pgCode(await settle(app.sql`select * from public.team_invitation_accept(${inv.hash}, ${u!.id})`))).toBe("P0002");
  });

  it("app role cannot call the internal consume function", async () => {
    const err = await settle(app.sql`select * from public.team_invitation_consume_internal(${newToken().hash}, ${randomUUID()})`);
    expect(pgCode(err)).toBe("42501");
  });

  it("revoke_sessions_if_orphaned only touches users without memberships", async () => {
    const [n] = await app.sql<{ n: number }[]>`select public.revoke_sessions_if_orphaned(${userIds[0]!}) as n`;
    expect(n?.n).toBe(0);
  });
});
