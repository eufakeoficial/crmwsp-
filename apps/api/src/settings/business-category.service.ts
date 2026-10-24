import { Inject, Injectable } from "@nestjs/common";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError, type BusinessCategoryOption, type BusinessCategoryState } from "@crmwsp/contracts";
import { eq, sql, tenants, withTenant, type Transaction } from "@crmwsp/db";
import { CATEGORY_REFUSED_MESSAGE, canConnectWhatsApp, decideBusinessCategory, type CategoryDecision } from "@crmwsp/domain";
import { DB_HANDLE, type DbHandle } from "../common/http.js";
import type { TenantDb } from "../db/tenant-db.js";
import { pgCode } from "../inbox/audit.js";

export const CATEGORY_REVIEW_BLOCKS_CHANNELS =
  "Tu rubro está en revisión (o fue rechazado): podrás conectar WhatsApp cuando el equipo de la plataforma lo apruebe.";

/** Maps tenant_set_business_category errors (0077) to API errors. */
function mapCategoryError(err: unknown): never {
  switch (pgCode(err)) {
    case "42501":
      throw new ValidationError(CATEGORY_REFUSED_MESSAGE);
    case "22023":
      throw new ValidationError("Rubro desconocido.");
    case "55000":
      throw new ConflictError("El rubro está en revisión: solo el equipo de la plataforma puede cambiarlo.");
    default:
      throw err;
  }
}

/** Business category catalog and per-tenant category state (ADR 0021, T1). */
@Injectable()
export class BusinessCategoryService {
  constructor(@Inject(DB_HANDLE) private readonly handle: DbHandle) {}

  async list(): Promise<BusinessCategoryOption[]> {
    const rows = await this.handle.sql<{ key: string; label: string; action: BusinessCategoryOption["action"]; guidance: string | null }[]>`
      select key, label, action, guidance from public.business_category_list()`;
    return rows.map((r) => ({ key: r.key, label: r.label, action: r.action, guidance: r.guidance }));
  }

  /** Decision for a key, from the live catalog (unknown key = refused). */
  async decide(key: string): Promise<CategoryDecision> {
    const opt = (await this.list()).find((o) => o.key === key);
    return decideBusinessCategory(opt ? { ...opt, active: true } : undefined);
  }

  /** Sets the category inside the caller's tenant transaction. Returns the new review status. */
  async setInTx(tx: Transaction, tenantId: string, key: string, detail: string | null): Promise<string> {
    try {
      const rows = await tx.execute<{ status: string }>(
        sql`select public.tenant_set_business_category(${tenantId}::uuid, ${key}, ${detail}) as status`,
      );
      return rows[0]?.status ?? "none";
    } catch (err) {
      mapCategoryError(err);
    }
  }

  /** Signup path: the tenant was just created, open its RLS context. */
  async setForNewTenant(tenantId: string, key: string, detail: string | null): Promise<void> {
    await withTenant(this.handle.db, tenantId, (tx) => this.setInTx(tx, tenantId, key, detail));
  }

  /** Throws 403 while the tenant's category review is pending or rejected. */
  async assertCanConnect(db: TenantDb): Promise<void> {
    const [t] = await db.run((tx) => tx.select({ status: tenants.categoryReviewStatus }).from(tenants).where(eq(tenants.id, db.tenantId)));
    if (t && !canConnectWhatsApp(t.status)) throw new ForbiddenError(CATEGORY_REVIEW_BLOCKS_CHANNELS);
  }

  async state(tx: Transaction, tenantId: string): Promise<BusinessCategoryState> {
    const [t] = await tx
      .select({
        category: tenants.businessCategory,
        detail: tenants.businessCategoryDetail,
        status: tenants.categoryReviewStatus,
        reason: tenants.categoryReviewReason,
      })
      .from(tenants)
      .where(eq(tenants.id, tenantId));
    if (!t) throw new NotFoundError();
    const opt = t.category ? (await this.list()).find((o) => o.key === t.category) : undefined;
    return {
      category: t.category,
      label: opt?.label ?? null,
      action: opt?.action ?? null,
      detail: t.detail,
      reviewStatus: t.status,
      reviewReason: t.reason,
      guidance: opt?.guidance ?? null,
      canConnectWhatsApp: canConnectWhatsApp(t.status),
    };
  }
}

