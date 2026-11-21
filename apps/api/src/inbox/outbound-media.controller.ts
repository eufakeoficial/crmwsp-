import { randomUUID } from "node:crypto";
import { Controller, Inject, Param, Post, Req, UseGuards } from "@nestjs/common";
import { MAX_IMAGE_BYTES, NotFoundError, ValidationError, type OutboundMediaUploadResponse } from "@crmwsp/contracts";
import { isUuid } from "@crmwsp/db";
import { CurrentTenant, CurrentTenantDb, Roles } from "../auth/decorators.js";
import { TenantGuard } from "../auth/tenant.guard.js";
import type { HttpRequest, RequestTenant } from "../common/http.js";
import type { TenantDb } from "../db/tenant-db.js";
import { PlanLimitsService } from "../billing/plan-limits.service.js";
import { sniffImage } from "../commerce/media.controller.js";
import { StorageHolder } from "../storage/object-storage.js";
import { writeAudit } from "./audit.js";
import { assertConversationVisible } from "./inbox-v2.scope.js";

const SIGNED_URL_TTL_SECONDS = 300;
/** WhatsApp images are JPEG or PNG only (WebP is for stickers). */
const OUTBOUND_IMAGE_MIME = ["image/jpeg", "image/png"] as const;

interface MultipartPart {
  type: "file" | "field";
  fieldname: string;
  mimetype?: string;
  file: AsyncIterable<Buffer> & { destroy(): unknown };
  toBuffer(): Promise<Buffer>;
}
interface MultipartRequest extends HttpRequest {
  isMultipart?: () => boolean;
  parts(): AsyncIterableIterator<MultipartPart>;
}

const invalid = (message: string): ValidationError =>
  new ValidationError("Validation failed", { details: [{ path: "file", message }] });

async function readImage(req: MultipartRequest): Promise<{ data: Buffer; mime: (typeof OUTBOUND_IMAGE_MIME)[number]; ext: "jpg" | "png" }> {
  if (req.isMultipart?.() !== true) throw invalid("An image file is required");
  let file: { data: Buffer; declared: string } | undefined;
  for await (const part of req.parts()) {
    if (part.type === "field") continue;
    if (part.fieldname !== "file" || file) {
      await part.toBuffer().catch(() => undefined);
      throw invalid("Send exactly one file in the 'file' field");
    }
    const declared = (part.mimetype ?? "").toLowerCase().split(";")[0]?.trim() ?? "";
    if (!(OUTBOUND_IMAGE_MIME as readonly string[]).includes(declared)) {
      await part.toBuffer().catch(() => undefined);
      throw invalid("Only JPEG or PNG images are allowed");
    }
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of part.file) {
      size += chunk.length;
      if (size > MAX_IMAGE_BYTES) {
        part.file.destroy();
        throw invalid("The image exceeds 5 MB");
      }
      chunks.push(chunk);
    }
    file = { data: Buffer.concat(chunks), declared };
  }
  if (!file || file.data.length === 0) throw invalid("An image file is required");
  const sniffed = sniffImage(file.data);
  if (!sniffed || sniffed.mime !== file.declared || sniffed.ext === "webp" || sniffed.mime === "image/webp") throw invalid("file content is not a valid JPEG or PNG image");
  return { data: file.data, mime: sniffed.mime, ext: sniffed.ext };
}

@Controller("conversations")
@UseGuards(TenantGuard)
export class OutboundMediaController {
  constructor(
    @Inject(StorageHolder) private readonly storage: StorageHolder,
    @Inject(PlanLimitsService) private readonly planLimits: PlanLimitsService,
  ) {}

  @Post(":id/media")
  @Roles("owner", "admin", "agent")
  async upload(
    @CurrentTenantDb() db: TenantDb,
    @CurrentTenant() tenant: RequestTenant,
    @Param("id") id: string,
    @Req() req: MultipartRequest,
  ): Promise<OutboundMediaUploadResponse> {
    if (!isUuid(id)) throw new NotFoundError();
    const storage = this.storage.require();
    const image = await readImage(req);
    await db.run(async (tx) => {
      await this.planLimits.assertSubscriptionActive(db.tenantId, tx);
      await assertConversationVisible(tx, db.tenantId, tenant.role, db.userId, id);
    });

    const uploadId = randomUUID();
    const key = "tenants/" + db.tenantId + "/outbound/" + id + "/" + uploadId + "." + image.ext;
    await storage.put(key, image.data, image.mime);
    try {
      const previewUrl = await storage.signedGetUrl(key, SIGNED_URL_TTL_SECONDS);
      await db.run((tx) => writeAudit(tx, {
        tenantId: db.tenantId,
        userId: db.userId,
        entity: "conversation",
        entityId: id,
        action: "message.media_uploaded",
        diff: { uploadId, mime: image.mime, size: image.data.length },
        ip: req.ip,
      }));
      return {
        uploadId,
        mime: image.mime,
        size: image.data.length,
        previewUrl,
        expiresAt: new Date(Date.now() + SIGNED_URL_TTL_SECONDS * 1000).toISOString(),
      };
    } catch (err) {
      await storage.delete(key).catch(() => undefined);
      throw err;
    }
  }
}
