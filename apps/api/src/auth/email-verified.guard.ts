import { type CanActivate, type ExecutionContext, Injectable } from "@nestjs/common";
import { EmailNotVerifiedError, UnauthorizedError } from "@crmwsp/contracts";
import { sql } from "@crmwsp/db";
import { emailAllowsWhatsAppConnect } from "@crmwsp/domain";
import type { HttpRequest } from "../common/http.js";

/**
 * Blocks WhatsApp channel connection until the tenant owner's email is verified
 * (403 EMAIL_NOT_VERIFIED). Everything else stays usable while unverified.
 * Must run after TenantGuard (needs `req.tenantDb`).
 */
@Injectable()
export class EmailVerifiedGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<HttpRequest>();
    const db = req.tenantDb;
    if (!db) throw new UnauthorizedError();
    const ownerEmailVerified = await db.run(async (tx) => {
      const [r] = await tx.execute<{ ok: boolean }>(sql`select public.tenant_owner_email_verified(${db.tenantId}::uuid) as ok`);
      return r?.ok === true;
    });
    if (!emailAllowsWhatsAppConnect({ ownerEmailVerified })) throw new EmailNotVerifiedError();
    return true;
  }
}
