import { broadcastRecipients, broadcasts, consents, type MessageStatus, type Transaction } from "@crmwsp/db";
import { isOptOutMessage } from "@crmwsp/domain";
import { and, eq, inArray, sql } from "drizzle-orm";
import { previousStatusesFor } from "../status.js";

/**
 * Revokes the contact's marketing consent when the reply is an opt-out keyword (BAJA/STOP) and
 * skips its pending recipients of open campaigns. Returns true only when the consent was not
 * already revoked (a repeated "STOP" is still recorded, but the caller confirms only once).
 */
export async function recordMarketingOptOut(
  tx: Transaction,
  tenantId: string,
  contactId: string,
  body: string | null,
  externalMessageId: string,
): Promise<boolean> {
  if (!isOptOutMessage(body)) return false;
  const now = new Date();
  const evidence = { source: "whatsapp_opt_out_keyword", messageId: externalMessageId, text: (body ?? "").slice(0, 100) };
  const [prev] = await tx
    .select({ status: consents.status })
    .from(consents)
    .where(and(eq(consents.contactId, contactId), eq(consents.kind, "marketing")))
    .limit(1);
  await tx
    .insert(consents)
    .values({ tenantId, contactId, kind: "marketing", status: "revoked", evidence, revokedAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: [consents.tenantId, consents.contactId, consents.kind],
      set: { status: "revoked", evidence, revokedAt: now, updatedAt: now },
    });
  // Not-yet-materialised recipients (no message) are skipped right away; queued ones are re-checked by the tick.
  await tx
    .update(broadcastRecipients)
    .set({ status: "skipped", error: { code: "opted_out" }, updatedAt: now })
    .where(
      and(
        eq(broadcastRecipients.contactId, contactId),
        eq(broadcastRecipients.status, "pending"),
        sql`${broadcastRecipients.messageId} is null`,
        inArray(
          broadcastRecipients.broadcastId,
          tx.select({ id: broadcasts.id }).from(broadcasts).where(inArray(broadcasts.status, ["scheduled", "sending"])),
        ),
      ),
    );
  return prev?.status !== "revoked";
}

/** Mirrors a BSP delivery status onto the broadcast recipient of that message (forward-only). */
export async function applyBroadcastStatus(tx: Transaction, messageId: string, next: MessageStatus): Promise<void> {
  if (next !== "sent" && next !== "delivered" && next !== "read" && next !== "failed") return;
  const prev = previousStatusesFor(next).map((s) => (s === "queued" ? "pending" : s)) as Array<
    "pending" | "sent" | "delivered" | "read"
  >;
  await tx
    .update(broadcastRecipients)
    .set({ status: next, updatedAt: new Date(), ...(next === "sent" ? { sentAt: new Date() } : {}) })
    .where(and(eq(broadcastRecipients.messageId, messageId), inArray(broadcastRecipients.status, prev)));
}
