/**
 * Grants or revokes the SaaS platform-admin role (ADR 0011). This is the ONLY way to create a
 * platform admin: no API endpoint can. Runs with the migrator role (DATABASE_URL_MIGRATOR); the
 * app role has no privileges on `platform_admins`.
 *
 * Usage:
 *   pnpm --filter @crmwsp/db platform-admin:grant <email>
 *   pnpm --filter @crmwsp/db platform-admin:revoke <email>
 *   pnpm --filter @crmwsp/db platform-admin:list
 *
 * The user must already exist (sign up first). Every change is written to platform_audit_events.
 */
import postgres from "postgres";

type Command = "grant" | "revoke" | "list";

async function main(): Promise<number> {
  const [cmd, rawEmail] = process.argv.slice(2) as [string | undefined, string | undefined];
  if (cmd !== "grant" && cmd !== "revoke" && cmd !== "list") {
    console.error("usage: platform-admin <grant|revoke|list> [email]");
    return 2;
  }
  const command: Command = cmd;
  const url = process.env["DATABASE_URL_MIGRATOR"];
  if (!url) {
    console.error("DATABASE_URL_MIGRATOR is required (migrator role).");
    return 2;
  }
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    if (command === "list") {
      const rows = await sql<{ email: string; created_at: Date }[]>`
        select u.email, a.created_at from platform_admins a join users u on u.id = a.user_id order by a.created_at`;
      for (const r of rows) console.log(`${r.email}\t${r.created_at.toISOString()}`);
      if (rows.length === 0) console.log("(no platform admins)");
      return 0;
    }
    const email = (rawEmail ?? "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+$/.test(email)) {
      console.error("A valid email is required.");
      return 2;
    }
    return await sql.begin(async (tx) => {
      const [user] = await tx<{ id: string }[]>`select id from users where lower(email) = ${email}`;
      if (!user) {
        console.error(`No user with email ${email}. Sign up first, then grant.`);
        return 1;
      }
      if (command === "grant") {
        const ins = await tx`insert into platform_admins (user_id) values (${user.id}) on conflict do nothing returning user_id`;
        if (ins.length > 0) {
          await tx`insert into platform_audit_events (actor_id, action, diff)
                   values (null, 'platform_admin.granted', ${tx.json({ userId: user.id, via: "cli" })})`;
        }
        console.log(ins.length > 0 ? `Granted platform admin to ${email}.` : `${email} is already a platform admin.`);
      } else {
        const del = await tx`delete from platform_admins where user_id = ${user.id} returning user_id`;
        if (del.length > 0) {
          await tx`insert into platform_audit_events (actor_id, action, diff)
                   values (null, 'platform_admin.revoked', ${tx.json({ userId: user.id, via: "cli" })})`;
        }
        console.log(del.length > 0 ? `Revoked platform admin from ${email}.` : `${email} was not a platform admin.`);
      }
      return 0;
    });
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error("platform-admin failed:", (err as Error).message);
    process.exit(1);
  },
);
