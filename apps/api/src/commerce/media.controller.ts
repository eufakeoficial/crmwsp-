import { randomUUID } from "node:crypto";
import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Req, UseGuards } from "@nestjs/common";
import {
  ALLOWED_IMAGE_MIME,
  MAX_IMAGE_BYTES,
  NotFoundError,
  ValidationError,
  uuidSchema,
  videoLinkRequestSchema,
  type Media,
  type MediaUrlResponse,
} from "@crmwsp/contracts";
import { and, eq, isUuid, productMedia, productVariants, products, sql } from "@crmwsp/db";
import { CurrentTenantDb, Roles } from "../auth/decorators.js";
import { TenantGuard } from "../auth/tenant.guard.js";
import type { HttpRequest } from "../common/http.js";
import { parseOrThrow } from "../common/zod.js";
import type { TenantDb } from "../db/tenant-db.js";
import { writeAudit } from "../inbox/audit.js";
import { StorageHolder } from "../storage/object-storage.js";
import { mediaDto } from "./products.queries.js";

const MAX_MEDIA_PER_PRODUCT = 30;
const SIGNED_URL_TTL_SECONDS = 300;

interface MultipartPart {
  type: "file" | "field";
  fieldname: string;
  filename?: string;
  mimetype?: string;
  value?: unknown;
  file: AsyncIterable<Buffer> & { destroy(): unknown };
  toBuffer(): Promise<Buffer>;
}
interface MultipartRequest extends HttpRequest {
  isMultipart?: () => boolean;
  parts(): AsyncIterableIterator<MultipartPart>;
}

const invalid = (path: string, message: string): ValidationError =>
  new ValidationError("Validation failed", { details: [{ path, message }] });

type ImageExt = "jpg" | "png" | "webp";

/** Content sniffing: the declared MIME is not trusted on its own. */
export function sniffImage(buf: Buffer): { mime: (typeof ALLOWED_IMAGE_MIME)[number]; ext: ImageExt } | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: "image/jpeg", ext: "jpg" };
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { mime: "image/png", ext: "png" };
  }
  if (buf.length >= 12 && buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP") {
    return { mime: "image/webp", ext: "webp" };
  }
  return null;
}

async function readImage(req: MultipartRequest): Promise<{ data: Buffer; mime: string; ext: ImageExt; variantId?: string; alt?: string }> {
  let file: { data: Buffer; declared: string } | undefined;
  let variantId: string | undefined;
  let alt: string | undefined;
  for await (const part of req.parts()) {
    if (part.type === "field") {
      if (part.fieldname === "variantId" && typeof part.value === "string" && part.value !== "") variantId = part.value;
      if (part.fieldname === "alt" && typeof part.value === "string") alt = part.value.trim().slice(0, 200);
      continue;
    }
    if (part.fieldname !== "file" || file) {
      await part.toBuffer().catch(() => undefined);
      throw invalid("file", "Send exactly one file in the 'file' field");
    }
    const declared = (part.mimetype ?? "").toLowerCase().split(";")[0]?.trim() ?? "";
    if (!(ALLOWED_IMAGE_MIME as readonly string[]).includes(declared)) {
      await part.toBuffer().catch(() => undefined);
      throw invalid("file", "Only JPEG, PNG or WebP images are allowed");
    }
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of part.file) {
      size += chunk.length;
      if (size > MAX_IMAGE_BYTES) {
        part.file.destroy();
        throw invalid("file", "The image exceeds 5 MB");
      }
      chunks.push(chunk);
    }
    file = { data: Buffer.concat(chunks), declared };
  }
  if (!file || file.data.length === 0) throw invalid("file", "An image file is required");
  const sniffed = sniffImage(file.data);
  if (!sniffed || sniffed.mime !== file.declared) throw invalid("file", "The file content is not a valid JPEG, PNG or WebP image");
  const variantParsed = variantId === undefined ? undefined : uuidSchema.safeParse(variantId);
  if (variantParsed && !variantParsed.success) throw invalid("variantId", "Invalid variantId");
  return { data: file.data, mime: sniffed.mime, ext: sniffed.ext, ...(variantId ? { variantId } : {}), ...(alt ? { alt } : {}) };
}

@Controller()
@UseGuards(TenantGuard)
export class MediaController {
  constructor(@Inject(StorageHolder) private readonly storage: StorageHolder) {}

  /** multipart (`file` image + optional `variantId`, `alt`) or JSON `{ kind: "video_link", url }`. */
  @Post("products/:id/media")
  @Roles("owner", "admin")
  async add(@CurrentTenantDb() db: TenantDb, @Param("id") id: string, @Req() req: MultipartRequest, @Body() body: unknown): Promise<Media> {
    if (!isUuid(id)) throw new NotFoundError();
    const multipart = req.isMultipart?.() === true;
    // Fail fast with a clear 503 before reading any upload.
    const storage = multipart ? this.storage.require() : null;

    let video: ReturnType<typeof videoLinkRequestSchema.parse> | undefined;
    let image: Awaited<ReturnType<typeof readImage>> | undefined;
    if (multipart) image = await readImage(req);
    else video = parseOrThrow(videoLinkRequestSchema, body);
    const variantId = image?.variantId ?? video?.variantId;
    const key = image ? `tenants/${db.tenantId}/products/${id}/${randomUUID()}.${image.ext}` : null;

    if (storage && image && key) await storage.put(key, image.data, image.mime);
    try {
      return await db.run(async (tx) => {
        const [p] = await tx.select({ id: products.id }).from(products).where(eq(products.id, id)).for("update");
        if (!p) throw new NotFoundError();
        if (variantId) {
          const [v] = await tx
            .select({ id: productVariants.id })
            .from(productVariants)
            .where(and(eq(productVariants.id, variantId), eq(productVariants.productId, id)));
          if (!v) throw invalid("variantId", "Variant does not belong to this product");
        }
        const [n] = await tx.select({ n: sql<number>`count(*)::int` }).from(productMedia).where(eq(productMedia.productId, id));
        if ((n?.n ?? 0) >= MAX_MEDIA_PER_PRODUCT) throw new ValidationError(`A product can have at most ${MAX_MEDIA_PER_PRODUCT} media items`);
        const [row] = await tx
          .insert(productMedia)
          .values({
            tenantId: db.tenantId,
            productId: id,
            variantId: variantId ?? null,
            kind: image ? "image" : "video_link",
            storageKey: key,
            url: video ? video.url : null,
            alt: image?.alt ?? video?.alt ?? null,
            position: n?.n ?? 0,
          })
          .returning();
        if (!row) throw new Error("insert returned no row");
        await writeAudit(tx, {
          tenantId: db.tenantId,
          userId: db.userId,
          entity: "product",
          entityId: id,
          action: "product.media_added",
          diff: { mediaId: row.id, kind: row.kind },
          ip: req.ip,
        });
        return mediaDto(row);
      });
    } catch (err) {
      if (storage && key) await storage.delete(key).catch(() => undefined);
      throw err;
    }
  }

  @Delete("products/:id/media/:mediaId")
  @Roles("owner", "admin")
  @HttpCode(204)
  async remove(@CurrentTenantDb() db: TenantDb, @Param("id") id: string, @Param("mediaId") mediaId: string, @Req() req: HttpRequest): Promise<void> {
    if (!isUuid(id) || !isUuid(mediaId)) throw new NotFoundError();
    const key = await db.run(async (tx) => {
      const [row] = await tx
        .delete(productMedia)
        .where(and(eq(productMedia.id, mediaId), eq(productMedia.productId, id)))
        .returning({ key: productMedia.storageKey, kind: productMedia.kind });
      if (!row) throw new NotFoundError();
      await writeAudit(tx, {
        tenantId: db.tenantId,
        userId: db.userId,
        entity: "product",
        entityId: id,
        action: "product.media_removed",
        diff: { mediaId, kind: row.kind },
        ip: req.ip,
      });
      return row.key;
    });
    if (key && this.storage.storage) await this.storage.storage.delete(key).catch(() => undefined);
  }

  /** Short-lived signed URL (images/documents) or the https link itself (videos). Never permanent. */
  @Get("media/:id")
  async url(@CurrentTenantDb() db: TenantDb, @Param("id") id: string): Promise<MediaUrlResponse> {
    if (!isUuid(id)) throw new NotFoundError();
    const [row] = await db.run((tx) =>
      tx.select({ kind: productMedia.kind, key: productMedia.storageKey, url: productMedia.url }).from(productMedia).where(eq(productMedia.id, id)),
    );
    if (!row) throw new NotFoundError();
    if (row.kind === "video_link" && row.url) return { url: row.url, expiresAt: null };
    if (!row.key) throw new NotFoundError();
    const url = await this.storage.require().signedGetUrl(row.key, SIGNED_URL_TTL_SECONDS);
    return { url, expiresAt: new Date(Date.now() + SIGNED_URL_TTL_SECONDS * 1000).toISOString() };
  }
}
