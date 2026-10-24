import { Body, Controller, Inject, Post, Req, UseGuards } from "@nestjs/common";
import { ConflictError, ValidationError, createContactRequestSchema, type Contact } from "@crmwsp/contracts";
import { contacts, eq } from "@crmwsp/db";
import { normalizePhoneE164 } from "@crmwsp/domain";
import { CurrentTenantDb, Roles } from "../auth/decorators.js";
import { TenantGuard } from "../auth/tenant.guard.js";
import { ActivationGuard } from "../billing/activation.guard.js";
import { PlanLimitsService } from "../billing/plan-limits.service.js";
import type { HttpRequest } from "../common/http.js";
import { parseOrThrow } from "../common/zod.js";
import type { TenantDb } from "../db/tenant-db.js";
import { PG_UNIQUE_VIOLATION, pgCode, writeAudit } from "../inbox/audit.js";

/** Manual contact creation from the Contactos screen (POST /contacts; reads live in the inbox controller). */
@Controller("contacts")
@UseGuards(TenantGuard, ActivationGuard)
export class ContactCreateController {
  constructor(@Inject(PlanLimitsService) private readonly limits: Pick<PlanLimitsService, "assert" | "lock">) {}

  @Post()
  @Roles("owner", "admin", "agent")
  async create(@CurrentTenantDb() db: TenantDb, @Body() body: unknown, @Req() req: HttpRequest): Promise<Contact> {
    const input = parseOrThrow(createContactRequestSchema, body);
    const phoneE164 = normalizePhoneE164(input.phone);
    if (!phoneE164) throw new ValidationError("Invalid phone number");
    const duplicate = (contactId: string) => new ConflictError("A contact with this phone already exists", { details: { contactId } });
    try {
      return await db.run(async (tx) => {
        await this.limits.lock(tx, db.tenantId, "contacts");
        const [existing] = await tx.select({ id: contacts.id }).from(contacts).where(eq(contacts.phoneE164, phoneE164));
        if (existing) throw duplicate(existing.id);
        await this.limits.assert(db.tenantId, "contacts", 1, tx);
        const [row] = await tx
          .insert(contacts)
          .values({
            tenantId: db.tenantId,
            phoneE164,
            name: input.name ?? null,
            source: "organic",
            extracted: input.email ? { email: input.email } : {},
          })
          .returning();
        if (!row) throw new Error("insert returned no row");
        await writeAudit(tx, {
          tenantId: db.tenantId,
          userId: db.userId,
          entity: "contact",
          entityId: row.id,
          action: "contact.created",
          diff: { source: "manual" },
          ip: req.ip,
        });
        return {
          id: row.id,
          name: row.name,
          phoneE164: row.phoneE164,
          tags: row.tags,
          extracted: row.extracted,
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
        };
      });
    } catch (err) {
      if (pgCode(err) !== PG_UNIQUE_VIOLATION) throw err;
      // Lost a race with another writer: point to the winner.
      const [winner] = await db.run((tx) => tx.select({ id: contacts.id }).from(contacts).where(eq(contacts.phoneE164, phoneE164)));
      throw winner ? duplicate(winner.id) : err;
    }
  }
}
