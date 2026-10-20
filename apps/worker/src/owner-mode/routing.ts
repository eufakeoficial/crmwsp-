import { channelConnections, findVerifiedOwner, ownerCommands, type Transaction } from "@crmwsp/db";
import { and, eq } from "drizzle-orm";

export interface OwnerInbound {
  tenantId: string;
  channelConnectionId: string;
  /** Sender as normalised by the provider (E.164). */
  fromE164: string;
  externalId: string;
  body: string | null;
}

export interface OwnerRouteResult {
  commandId: string;
  duplicate: boolean;
}

/**
 * Ingest hook (inside the tenant transaction). When the sender is a verified owner/admin phone of
 * this tenant and the message arrived on one of this tenant's channels, the message is recorded as
 * an owner command and must NOT go through the customer pipeline (no contact, no conversation, no
 * AI turn). Returns null for everyone else, including pending (unverified) owner phones.
 */
export async function routeOwnerInbound(tx: Transaction, m: OwnerInbound): Promise<OwnerRouteResult | null> {
  // Exact E.164 only: the provider already normalised; anything else never matches.
  if (!/^\+[1-9]\d{6,14}$/u.test(m.fromE164)) return null;
  const owner = await findVerifiedOwner(tx, m.fromE164);
  if (!owner) return null;
  // The channel must belong to the tenant (RLS hides other tenants' rows) and be usable.
  const [channel] = await tx
    .select({ id: channelConnections.id })
    .from(channelConnections)
    .where(and(eq(channelConnections.id, m.channelConnectionId), eq(channelConnections.tenantId, m.tenantId)))
    .limit(1);
  if (!channel) return null;

  const [inserted] = await tx
    .insert(ownerCommands)
    .values({
      tenantId: m.tenantId,
      ownerPhoneId: owner.ownerPhoneId,
      userId: owner.userId,
      channelConnectionId: channel.id,
      inboundExternalId: m.externalId,
      body: m.body ? m.body.slice(0, 2000) : null,
    })
    .onConflictDoNothing({ target: [ownerCommands.tenantId, ownerCommands.inboundExternalId] })
    .returning({ id: ownerCommands.id });
  if (inserted) return { commandId: inserted.id, duplicate: false };
  const [existing] = await tx
    .select({ id: ownerCommands.id })
    .from(ownerCommands)
    .where(eq(ownerCommands.inboundExternalId, m.externalId))
    .limit(1);
  if (!existing) throw new Error("owner command conflict without row");
  return { commandId: existing.id, duplicate: true };
}
