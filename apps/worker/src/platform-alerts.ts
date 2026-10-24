import { sql, type Database } from "@crmwsp/db";
import type { Logger } from "./processors.js";

/** Minimal mailer (the @crmwsp/mailer Mailer satisfies it). */
export interface AlertMailer {
  send(m: { to: string; subject: string; text: string }): Promise<unknown>;
}

/**
 * E-mails every platform admin (platform_alert_recipients, 0078). Best effort: a failed send is
 * logged without the address and never fails the caller. Texts must not carry secrets or customer data.
 */
export async function notifyPlatformAdmins(db: Database, mailer: AlertMailer | undefined, subject: string, text: string, logger?: Logger): Promise<number> {
  if (!mailer) return 0;
  let sent = 0;
  try {
    const rows = await db.execute<{ email: string }>(sql`select email from public.platform_alert_recipients()`);
    for (const r of rows) {
      try {
        await mailer.send({ to: r.email, subject: subject.slice(0, 200), text: text.slice(0, 20_000) });
        sent++;
      } catch (err) {
        logger?.warn(`platform alert email failed (${err instanceof Error ? err.name : "unknown"})`);
      }
    }
  } catch (err) {
    logger?.warn(`platform alert recipients unavailable (${err instanceof Error ? err.name : "unknown"})`);
  }
  return sent;
}
