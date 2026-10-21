import { randomUUID } from "node:crypto";
import { Body, Controller, HttpCode, Post, Req, UseGuards } from "@nestjs/common";
import {
  BULK_MAX_ROWS,
  ValidationError,
  contactBulkRequestSchema,
  importContactsRequestSchema,
  parseContactCsv,
  type ContactBulkResult,
  type ImportContactsResult,
} from "@crmwsp/contracts";
import { consents, contacts, inArray, sql, type ConsentEvidence, type Transaction } from "@crmwsp/db";
import { mergeTags, planContactImport } from "@crmwsp/domain";
import { CurrentTenantDb, Roles } from "../auth/decorators.js";
import { TenantGuard } from "../auth/tenant.guard.js";
import type { HttpRequest } from "../common/http.js";
import { parseOrThrow } from "../common/zod.js";
import type { TenantDb } from "../db/tenant-db.js";
import { writeAudit } from "../inbox/audit.js";
import { contactFilterWhere } from "./contact-query.js";

const CHUNK = 1000;
const MAX_TAGS = 30;

function chunks<T>(list: readonly T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

const uuidArray = (ids: readonly string[]) => sql`array[${sql.join(ids.map((id) => sql`${id}`), sql`, `)}]::uuid[]`;

interface ConsentWrite {
  contactId: string;
  granted: boolean;
  evidence: ConsentEvidence;
}

async function upsertMarketingConsents(tx: Transaction, tenantId: string, writes: readonly ConsentWrite[]): Promise<void> {
  const now = new Date();
  for (const part of chunks(writes)) {
    await tx
      .insert(consents)
      .values(
        part.map((w) => ({
          tenantId,
          contactId: w.contactId,
          kind: "marketing" as const,
          status: w.granted ? ("granted" as const) : ("revoked" as const),
          evidence: w.evidence,
          grantedAt: w.granted ? now : null,
          revokedAt: w.granted ? null : now,
          updatedAt: now,
        })),
      )
      .onConflictDoUpdate({
        target: [consents.tenantId, consents.contactId, consents.kind],
        set: {
          status: sql`excluded.status`,
          evidence: sql`excluded.evidence`,
          grantedAt: sql`coalesce(excluded.granted_at, ${consents.grantedAt})`,
          revokedAt: sql`excluded.revoked_at`,
          updatedAt: now,
        },
      });
  }
}

@Controller("contact-book")
@UseGuards(TenantGuard)
export class ContactBulkController {
  /** Tag / consent changes over an explicit id list or every contact matching a filter (max 10k). */
  @Post("bulk")
  @HttpCode(200)
  @Roles("owner", "admin", "agent")
  async bulk(@CurrentTenantDb() db: TenantDb, @Req() req: HttpRequest, @Body() body: unknown): Promise<ContactBulkResult> {
    const input = parseOrThrow(contactBulkRequestSchema, body);
    return db.run(async (tx) => {
      const sel = input.selection;
      const where = "ids" in sel ? inArray(contacts.id, sel.ids) : await contactFilterWhere(tx, sel.filter, sel.q);
      const rows = await tx.select({ id: contacts.id }).from(contacts).where(where).limit(BULK_MAX_ROWS + 1);
      if (rows.length > BULK_MAX_ROWS) throw new ValidationError(`selection exceeds ${BULK_MAX_ROWS} contacts; narrow the filter`);
      const ids = rows.map((r) => r.id);
      let updated = 0;
      const now = new Date();
      for (const part of chunks(ids)) {
        if (input.action === "add_tag") {
          const res = await tx
            .update(contacts)
            .set({ tags: sql`array_append(${contacts.tags}, ${input.tag}::text)`, updatedAt: now })
            .where(sql`${contacts.id} = any(${uuidArray(part)}) and not (${input.tag}::text = any(${contacts.tags})) and cardinality(${contacts.tags}) < ${MAX_TAGS}`)
            .returning({ id: contacts.id });
          updated += res.length;
        } else if (input.action === "remove_tag") {
          const res = await tx
            .update(contacts)
            .set({ tags: sql`array_remove(${contacts.tags}, ${input.tag}::text)`, updatedAt: now })
            .where(sql`${contacts.id} = any(${uuidArray(part)}) and ${input.tag}::text = any(${contacts.tags})`)
            .returning({ id: contacts.id });
          updated += res.length;
        }
      }
      if (input.action === "set_marketing_consent") {
        const evidence = { source: "bulk_action", userId: db.userId };
        await upsertMarketingConsents(tx, db.tenantId, ids.map((contactId) => ({ contactId, granted: input.granted, evidence })));
        updated = ids.length;
      }
      await writeAudit(tx, {
        tenantId: db.tenantId,
        userId: db.userId,
        entity: "contact_bulk",
        entityId: randomUUID(),
        action: `contact.bulk_${input.action}`,
        diff: {
          selection: "ids" in sel ? "ids" : "filter",
          matched: ids.length,
          updated,
          ...(input.action === "set_marketing_consent" ? { granted: input.granted } : { tag: input.tag }),
        },
        ip: req.ip,
      });
      return { matched: ids.length, updated };
    });
  }

  /**
   * CSV import (max 5k rows): phone required and normalized to E.164, deduped by phone (in the file
   * and against the book). Tags are merged; marketing consent is only written when the file has an
   * explicit column, with `{source: "csv_import"}` evidence.
   */
  @Post("import")
  @HttpCode(200)
  @Roles("owner", "admin", "agent")
  async import(@CurrentTenantDb() db: TenantDb, @Req() req: HttpRequest, @Body() body: unknown): Promise<ImportContactsResult> {
    const { csv } = parseOrThrow(importContactsRequestSchema, body);
    const parsed = parseContactCsv(csv);
    if (!parsed.columns.phone) throw new ValidationError("the file needs a phone column (phone / telefono)");
    if (parsed.truncated) throw new ValidationError("the file has more than 5000 rows");
    const plan = planContactImport(parsed.rows);
    return db.run(async (tx) => {
      let created = 0;
      let updated = 0;
      const consentWrites: ConsentWrite[] = [];
      const importId = randomUUID();
      for (const part of chunks(plan.rows, 500)) {
        const existing = await tx
          .select({ id: contacts.id, phoneE164: contacts.phoneE164, name: contacts.name, tags: contacts.tags, extracted: contacts.extracted })
          .from(contacts)
          .where(inArray(contacts.phoneE164, part.map((r) => r.phoneE164)));
        const byPhone = new Map(existing.map((e) => [e.phoneE164, e]));
        const now = new Date();
        const fresh = part.filter((r) => !byPhone.has(r.phoneE164));
        const inserted = fresh.length
          ? await tx
              .insert(contacts)
              .values(
                fresh.map((r) => ({
                  tenantId: db.tenantId,
                  phoneE164: r.phoneE164,
                  name: r.name,
                  tags: r.tags,
                  source: "import" as const,
                  extracted: r.email ? { email: r.email } : {},
                })),
              )
              .onConflictDoNothing({ target: [contacts.tenantId, contacts.phoneE164] })
              .returning({ id: contacts.id, phoneE164: contacts.phoneE164 })
          : [];
        created += inserted.length;
        const idOf = new Map<string, string>(inserted.map((i) => [i.phoneE164, i.id]));
        for (const r of part) {
          const e = byPhone.get(r.phoneE164);
          if (e) {
            idOf.set(r.phoneE164, e.id);
            const tags = mergeTags(e.tags, r.tags);
            const name = e.name?.trim() ? e.name : r.name;
            const extracted = r.email && !e.extracted.email ? { ...e.extracted, email: r.email } : e.extracted;
            const changed = tags.length !== e.tags.length || name !== e.name || extracted !== e.extracted;
            if (changed) await tx.update(contacts).set({ tags, name, extracted, updatedAt: now }).where(inArray(contacts.id, [e.id]));
            updated++;
          }
          const id = idOf.get(r.phoneE164);
          if (id && r.marketingConsent && parsed.columns.marketingConsent) {
            consentWrites.push({ contactId: id, granted: r.marketingConsent === "granted", evidence: { source: "csv_import", importId, line: r.line } });
          }
        }
      }
      if (consentWrites.length) await upsertMarketingConsents(tx, db.tenantId, consentWrites);
      await writeAudit(tx, {
        tenantId: db.tenantId,
        userId: db.userId,
        entity: "contact_import",
        entityId: importId,
        action: "contact.csv_imported",
        diff: { created, updated, skipped: plan.skipped.length, consents: consentWrites.length },
        ip: req.ip,
      });
      return { created, updated, skipped: plan.skipped };
    });
  }
}
