import { contactFilterSchema, type ContactFilter } from "@crmwsp/contracts";
import { contactSegments, contacts, ilike, inArray, isUuid, or, sql, type SQL, type Transaction } from "@crmwsp/db";
import { compileContactFilter, likeEscape, referencedSegmentIds } from "./filter-sql.js";

const MAX_SEGMENT_LOADS = 4;

/** Loads referenced segments transitively (bounded), tenant-scoped by RLS. Invalid stored filters are dropped. */
export async function loadSegmentFilters(tx: Transaction, filter: ContactFilter): Promise<Map<string, ContactFilter>> {
  const out = new Map<string, ContactFilter>();
  let pending = referencedSegmentIds(filter);
  for (let round = 0; round < MAX_SEGMENT_LOADS && pending.length; round++) {
    const ids = pending.filter((id) => isUuid(id) && !out.has(id));
    if (!ids.length) break;
    const rows = await tx.select({ id: contactSegments.id, filter: contactSegments.filter }).from(contactSegments).where(inArray(contactSegments.id, ids));
    pending = [];
    for (const r of rows) {
      const parsed = contactFilterSchema.safeParse(r.filter);
      if (!parsed.success) continue;
      out.set(r.id, parsed.data);
      pending.push(...referencedSegmentIds(parsed.data));
    }
  }
  return out;
}

/** WHERE predicate for a filter plus optional free-text search over name/phone. */
export async function contactFilterWhere(tx: Transaction, filter: ContactFilter, q?: string, now = new Date()): Promise<SQL | undefined> {
  const segments = await loadSegmentFilters(tx, filter);
  const predicate = compileContactFilter(filter, { segments, now });
  const pattern = q ? `%${likeEscape(q)}%` : undefined;
  const search = pattern ? or(ilike(contacts.name, pattern), ilike(contacts.phoneE164, pattern)) : undefined;
  if (predicate && search) return sql`(${predicate} and ${search})`;
  return predicate ?? search;
}

export async function countContacts(tx: Transaction, where: SQL | undefined): Promise<number> {
  const [row] = await tx.select({ n: sql<number>`count(*)::int` }).from(contacts).where(where);
  return row?.n ?? 0;
}
