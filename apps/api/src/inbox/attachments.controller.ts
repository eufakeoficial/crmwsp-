import { Controller, Get, Inject, Param, UseGuards } from "@nestjs/common";
import { NotFoundError, type AttachmentUrlResponse } from "@crmwsp/contracts";
import { attachments, eq, isUuid } from "@crmwsp/db";
import { CurrentTenantDb } from "../auth/decorators.js";
import { TenantGuard } from "../auth/tenant.guard.js";
import type { TenantDb } from "../db/tenant-db.js";
import { StorageHolder } from "../storage/object-storage.js";

export const ATTACHMENT_URL_TTL_SECONDS = 300;

@Controller("attachments")
@UseGuards(TenantGuard)
export class AttachmentsController {
  constructor(@Inject(StorageHolder) private readonly storage: StorageHolder) {}

  /** Short-lived signed URL. The row lookup runs under RLS, so other tenants' ids answer 404. */
  @Get(":id/url")
  async url(@CurrentTenantDb() db: TenantDb, @Param("id") id: string): Promise<AttachmentUrlResponse> {
    if (!isUuid(id)) throw new NotFoundError();
    const storage = this.storage.require();
    const [row] = await db.run((tx) =>
      tx.select({ storageKey: attachments.storageKey, mimeType: attachments.mimeType }).from(attachments).where(eq(attachments.id, id)).limit(1),
    );
    if (!row?.storageKey) throw new NotFoundError();
    const url = await storage.signedGetUrl(row.storageKey, ATTACHMENT_URL_TTL_SECONDS);
    return { url, expiresAt: new Date(Date.now() + ATTACHMENT_URL_TTL_SECONDS * 1000).toISOString(), mimeType: row.mimeType };
  }
}
