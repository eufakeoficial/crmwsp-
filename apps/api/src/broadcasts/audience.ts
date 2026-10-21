import type { BroadcastAudience, BroadcastVariableSource } from "@crmwsp/contracts";
import { and, asc, consents, contacts, eq, sql, type Transaction } from "@crmwsp/db";
import { contactFilterWhere } from "../contacts/contact-query.js";
import { MissingTemplateVariableError, resolveAudience, resolveBroadcastParams, type AudienceContact } from "@crmwsp/domain";

const textArray = (values: readonly string[]) => sql`array[${sql.join(values.map((v) => sql`${v}`), sql`, `)}]::text[]`;

/** Contacts matching the tag filter, with their marketing consent (RLS-scoped, oldest first). */
export async function loadAudienceContacts(tx: Transaction, audience: BroadcastAudience): Promise<AudienceContact[]> {
  const where = [
    audience.tags.length ? sql`${contacts.tags} @> ${textArray(audience.tags)}` : undefined,
    audience.excludeTags.length ? sql`not (${contacts.tags} && ${textArray(audience.excludeTags)})` : undefined,
    audience.segmentId
      ? await contactFilterWhere(tx, {
          match: "all",
          conditions: [{ field: "segment", type: "relation", operator: "is", value: [audience.segmentId] }],
        })
      : undefined,
  ].filter((w) => w !== undefined);
  const rows = await tx
    .select({
      id: contacts.id,
      phoneE164: contacts.phoneE164,
      name: contacts.name,
      tags: contacts.tags,
      extracted: contacts.extracted,
      consent: consents.status,
    })
    .from(contacts)
    .leftJoin(consents, and(eq(consents.contactId, contacts.id), eq(consents.kind, "marketing")))
    .where(where.length ? and(...where) : undefined)
    .orderBy(asc(contacts.createdAt), asc(contacts.id));
  return rows.map(({ consent, ...c }) => ({ ...c, marketingConsent: consent ?? null }));
}

export interface PlannedRecipient {
  contactId: string;
  phoneE164: string;
  params: string[];
}

export interface RecipientPlan {
  recipients: PlannedRecipient[];
  excludedNoConsent: number;
  duplicates: number;
  /** Opted-in contacts dropped because a template variable has no value for them. */
  missingVariables: number;
}

/** Opt-in filter + phone dedupe (domain) + per-contact template params. */
export function planRecipients(
  contactsList: readonly AudienceContact[],
  audience: BroadcastAudience,
  mapping: readonly BroadcastVariableSource[],
): RecipientPlan {
  const resolved = resolveAudience(contactsList, audience);
  const recipients: PlannedRecipient[] = [];
  let missingVariables = 0;
  for (const c of resolved.recipients) {
    try {
      recipients.push({ contactId: c.id, phoneE164: c.phoneE164, params: resolveBroadcastParams(mapping, c) });
    } catch (err) {
      if (!(err instanceof MissingTemplateVariableError)) throw err;
      missingVariables++;
    }
  }
  return { recipients, excludedNoConsent: resolved.excludedNoConsent, duplicates: resolved.duplicates, missingVariables };
}
