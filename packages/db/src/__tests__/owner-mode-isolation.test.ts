import { randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type DbHandle } from "../client.js";
import { runMigrations } from "../migrate.js";
import { findVerifiedOwner, hashOwnerSecret, ownerSecretMatches } from "../owner-mode.js";
import { aiPauses, channelConnections, memberships, ownerCommands, ownerPhones, tenants, users } from "../schema/index.js";
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
  membership: string;
  phone: string;
  command: string;
  connection: string;
}

describe("owner secret hashing", () => {
  it("matches only the same secret and salt", () => {
    const h = hashOwnerSecret("123456", "salt-a");
    expect(ownerSecretMatches(h, "123456", "salt-a")).toBe(true);
    expect(ownerSecretMatches(h, "123457", "salt-a")).toBe(false);
    expect(ownerSecretMatches(h, "123456", "salt-b")).toBe(false);
    expect(ownerSecretMatches(null, "123456", "salt-a")).toBe(false);
  });
});

describe.skipIf(!hasDb)("owner-mode tables RLS with the app role", () => {
  let migrator: DbHandle;
  let app: DbHandle;
  const suffix = randomUUID().slice(0, 8);
  let A: Seed;
  let B: Seed;
  // Same phone registered in both tenants: each tenant only resolves its own owner.
  const SHARED_PHONE = "+34611222333";

  async function seed(label: string): Promise<Seed> {
    return dangerouslyWithoutTenant(migrator.db, async (tx) => {
      const [t] = await tx.insert(tenants).values({ slug: `own-${label}-${suffix}`, name: `Tenant ${label}` }).returning({ id: tenants.id });
      const [u] = await tx.insert(users).values({ email: `own-${label}-${suffix}@example.test`, name: label }).returning({ id: users.id });
      if (!t || !u) throw new Error("seed failed");
      const [m] = await tx.insert(memberships).values({ tenantId: t.id, userId: u.id, role: "owner" }).returning({ id: memberships.id });
      const [c] = await tx
        .insert(channelConnections)
        .values({ tenantId: t.id, provider: "gupshup", phoneE164: "+34600000001", webhookToken: `tok-${label}-${suffix}`, status: "active" })
        .returning({ id: channelConnections.id });
      if (!m || !c) throw new Error("seed failed");
      const [p] = await tx
        .insert(ownerPhones)
        .values({ tenantId: t.id, membershipId: m.id, userId: u.id, phoneE164: SHARED_PHONE, status: "verified", verifiedAt: new Date() })
        .returning({ id: ownerPhones.id });
      if (!p) throw new Error("seed failed");
      const [cmd] = await tx
        .insert(ownerCommands)
        .values({ tenantId: t.id, ownerPhoneId: p.id, userId: u.id, channelConnectionId: c.id, inboundExternalId: `ext-${label}-${suffix}`, body: "/resumen" })
        .returning({ id: ownerCommands.id });
      await tx.insert(aiPauses).values({ tenantId: t.id, pausedAt: null });
      if (!cmd) throw new Error("seed failed");
      return { tenant: t.id, user: u.id, membership: m.id, phone: p.id, command: cmd.id, connection: c.id };
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
      const uids = [A?.user, B?.user].filter((x): x is string => Boolean(x));
      if (uids.length) await migrator.db.delete(users).where(inArray(users.id, uids));
      await migrator.close();
    }
    if (app) await app.close();
  });

  it("each tenant only sees its own owner phones, commands and AI pause", async () => {
    const rows = await withTenant(app.db, A.tenant, async (tx) => ({
      phones: await tx.select({ id: ownerPhones.id }).from(ownerPhones),
      cmds: await tx.select({ id: ownerCommands.id }).from(ownerCommands),
      pauses: await tx.select({ t: aiPauses.tenantId }).from(aiPauses),
    }));
    expect(rows.phones.map((r) => r.id)).toEqual([A.phone]);
    expect(rows.cmds.map((r) => r.id)).toEqual([A.command]);
    expect(rows.pauses.map((r) => r.t)).toEqual([A.tenant]);
    expect(await app.db.select({ id: ownerPhones.id }).from(ownerPhones)).toHaveLength(0);
  });

  it("the same phone resolves to each tenant's own verified owner (no cross-tenant routing)", async () => {
    const a = await withTenant(app.db, A.tenant, (tx) => findVerifiedOwner(tx, SHARED_PHONE));
    const b = await withTenant(app.db, B.tenant, (tx) => findVerifiedOwner(tx, SHARED_PHONE));
    expect(a?.ownerPhoneId).toBe(A.phone);
    expect(b?.ownerPhoneId).toBe(B.phone);
    expect(await withTenant(app.db, A.tenant, (tx) => findVerifiedOwner(tx, "+34611222334"))).toBeNull();
  });

  it("tenant A cannot update, delete nor insert B's rows; cross-tenant FKs are rejected", async () => {
    const upd = await withTenant(app.db, A.tenant, (tx) =>
      tx.update(ownerPhones).set({ status: "pending" }).where(eq(ownerPhones.id, B.phone)).returning({ id: ownerPhones.id }),
    );
    expect(upd).toHaveLength(0);
    const del = await withTenant(app.db, A.tenant, (tx) => tx.delete(ownerPhones).where(eq(ownerPhones.id, B.phone)).returning({ id: ownerPhones.id }));
    expect(del).toHaveLength(0);
    const ins = await settle(
      withTenant(app.db, A.tenant, (tx) =>
        tx.insert(ownerPhones).values({ tenantId: B.tenant, membershipId: B.membership, userId: B.user, phoneE164: "+34699999999" }),
      ),
    );
    expect(ins).toBeInstanceOf(Error);
    // Own tenant, but pointing at B's membership / phone / channel: composite FKs refuse it.
    const crossMembership = await settle(
      withTenant(app.db, A.tenant, (tx) =>
        tx.insert(ownerPhones).values({ tenantId: A.tenant, membershipId: B.membership, userId: B.user, phoneE164: "+34699999998" }),
      ),
    );
    expect(crossMembership).toBeInstanceOf(Error);
    const crossCommand = await settle(
      withTenant(app.db, A.tenant, (tx) =>
        tx.insert(ownerCommands).values({ tenantId: A.tenant, ownerPhoneId: A.phone, userId: A.user, channelConnectionId: B.connection, inboundExternalId: `x-${suffix}` }),
      ),
    );
    expect(crossCommand).toBeInstanceOf(Error);
  });

  it("the app role cannot delete owner commands (audit trail) and E.164 is enforced", async () => {
    const del = await settle(withTenant(app.db, A.tenant, (tx) => tx.delete(ownerCommands).where(eq(ownerCommands.id, A.command))));
    expect(del).toBeInstanceOf(Error);
    const bad = await settle(
      withTenant(app.db, A.tenant, (tx) => tx.update(ownerPhones).set({ phoneE164: "34611222333" }).where(eq(ownerPhones.id, A.phone))),
    );
    expect(bad).toBeInstanceOf(Error);
    const [{ n } = { n: 0 }] = await withTenant(app.db, A.tenant, (tx) =>
      tx.select({ n: sql<number>`count(*)::int` }).from(ownerCommands),
    );
    expect(n).toBe(1);
  });
});
