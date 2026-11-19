import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put, Req, UseGuards } from "@nestjs/common";
import type { CipherBox } from "@crmwsp/crypto";
import {
  EncryptionNotConfiguredError,
  GUPSHUP_PARTNER_TOKEN_PURPOSE,
  NotFoundError,
  ValidationError,
  WHATSAPP_PROFILE_PHOTO_MAX_BYTES,
  requestDisplayNameRequestSchema,
  updateWhatsappProfileRequestSchema,
  type WhatsappProfile,
  type WhatsappProfileActionResponse,
} from "@crmwsp/contracts";
import { channelConnections, eq, isUuid } from "@crmwsp/db";
import type { GupshupPartnerCreds, GupshupProfileClient } from "@crmwsp/whatsapp";
import { CurrentTenantDb, Roles } from "../auth/decorators.js";
import { TenantGuard } from "../auth/tenant.guard.js";
import { CIPHER_BOX } from "../channels/channels.constants.js";
import type { HttpRequest } from "../common/http.js";
import { parseOrThrow } from "../common/zod.js";
import type { TenantDb } from "../db/tenant-db.js";
import { writeAudit } from "../inbox/audit.js";

/** DI token: the Gupshup profile client (overridable in tests). */
export const GUPSHUP_PROFILE_CLIENT = Symbol("GUPSHUP_PROFILE_CLIENT");

export const MISSING_PARTNER_CREDENTIALS_MESSAGE =
  'Este canal no tiene el "ID de app" y el "Token de Partner" de Gupshup. Agrégalos en Canales (credenciales de plantillas) para poder editar el perfil.';

interface MultipartPart {
  type: "file" | "field";
  fieldname: string;
  filename?: string;
  mimetype?: string;
  file: AsyncIterable<Buffer> & { destroy(): unknown };
  toBuffer(): Promise<Buffer>;
}
interface MultipartRequest extends HttpRequest {
  parts(): AsyncIterableIterator<MultipartPart>;
}

const invalid = (path: string, message: string): ValidationError => new ValidationError("Validation failed", { details: [{ path, message }] });

/** Content sniffing: the declared MIME is not trusted on its own. jpg/png only. */
export function sniffProfileImage(buf: Buffer): { mime: "image/jpeg" | "image/png"; ext: "jpg" | "png" } | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: "image/jpeg", ext: "jpg" };
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: "image/png", ext: "png" };
  return null;
}

async function readPhoto(req: MultipartRequest): Promise<{ data: Buffer; mime: string; ext: string }> {
  let file: Buffer | undefined;
  for await (const part of req.parts()) {
    if (part.type === "field") continue;
    if (part.fieldname !== "file" || file) {
      await part.toBuffer().catch(() => undefined);
      throw invalid("file", "Send exactly one file in the 'file' field");
    }
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of part.file) {
      size += chunk.length;
      if (size > WHATSAPP_PROFILE_PHOTO_MAX_BYTES) {
        part.file.destroy();
        throw invalid("file", "The image exceeds 5 MB");
      }
      chunks.push(chunk);
    }
    file = Buffer.concat(chunks);
  }
  if (!file || file.length === 0) throw invalid("file", "An image file is required");
  const sniffed = sniffProfileImage(file);
  if (!sniffed) throw invalid("file", "Only JPG or PNG images are allowed");
  return { data: file, ...sniffed };
}

@Controller("whatsapp-profile")
@UseGuards(TenantGuard)
export class WhatsappProfileController {
  constructor(
    @Inject(CIPHER_BOX) private readonly cipher: CipherBox | null,
    @Inject(GUPSHUP_PROFILE_CLIENT) private readonly client: GupshupProfileClient,
  ) {}

  /** Loads the channel inside the tenant transaction and decrypts the Partner credentials. */
  private async credentials(db: TenantDb, channelId: string): Promise<GupshupPartnerCreds> {
    if (!isUuid(channelId)) throw new NotFoundError();
    const row = await db.run(async (tx) => {
      const [ch] = await tx
        .select({ provider: channelConnections.provider, appId: channelConnections.gupshupAppId, token: channelConnections.partnerTokenEncrypted })
        .from(channelConnections)
        .where(eq(channelConnections.id, channelId));
      return ch;
    });
    if (!row) throw new NotFoundError();
    if (row.provider !== "gupshup") throw new ValidationError("El perfil de WhatsApp solo se puede editar desde Vende+ en canales de Gupshup.");
    if (!row.appId || !row.token) throw new ValidationError(MISSING_PARTNER_CREDENTIALS_MESSAGE);
    if (!this.cipher) throw new EncryptionNotConfiguredError();
    const token = this.cipher.decrypt(row.token, { tenantId: db.tenantId, purpose: GUPSHUP_PARTNER_TOKEN_PURPOSE });
    return { appId: row.appId, token };
  }

  private audit(db: TenantDb, req: HttpRequest, channelId: string, action: string, diff: Record<string, unknown>): Promise<void> {
    return db.run((tx) => writeAudit(tx, { tenantId: db.tenantId, userId: db.userId, entity: "channel_connection", entityId: channelId, action, diff, ip: req.ip }));
  }

  @Get(":channelId")
  @Roles("owner", "admin")
  async get(@CurrentTenantDb() db: TenantDb, @Param("channelId") channelId: string): Promise<WhatsappProfile> {
    return this.client.getProfile(await this.credentials(db, channelId));
  }

  @Put(":channelId")
  @Roles("owner", "admin")
  async update(
    @CurrentTenantDb() db: TenantDb,
    @Param("channelId") channelId: string,
    @Body() body: unknown,
    @Req() req: HttpRequest,
  ): Promise<WhatsappProfileActionResponse> {
    const input = parseOrThrow(updateWhatsappProfileRequestSchema, body);
    const creds = await this.credentials(db, channelId);
    await this.client.updateProfile(creds, {
      ...(input.about !== undefined ? { about: input.about } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.address !== undefined ? { address: input.address } : {}),
      ...(input.email !== undefined ? { email: input.email } : {}),
      ...(input.website1 !== undefined ? { website1: input.website1 } : {}),
      ...(input.website2 !== undefined ? { website2: input.website2 } : {}),
      ...(input.vertical !== undefined ? { vertical: input.vertical } : {}),
    });
    await this.audit(db, req, channelId, "channel.whatsapp_profile_updated", { fields: Object.keys(input) });
    return { status: "ok" };
  }

  /** multipart: one `file` field (JPG/PNG, up to 5 MB). */
  @Post(":channelId/photo")
  @Roles("owner", "admin")
  @HttpCode(200)
  async photo(@CurrentTenantDb() db: TenantDb, @Param("channelId") channelId: string, @Req() req: MultipartRequest): Promise<WhatsappProfileActionResponse> {
    const creds = await this.credentials(db, channelId);
    const image = await readPhoto(req);
    await this.client.updatePhoto(creds, { data: image.data, mime: image.mime, filename: `profile.${image.ext}` });
    await this.audit(db, req, channelId, "channel.whatsapp_profile_photo_updated", {});
    return { status: "ok" };
  }

  /** Display-name change request: Meta must approve it (hours to 2 days). */
  @Post(":channelId/display-name")
  @Roles("owner", "admin")
  @HttpCode(200)
  async displayName(
    @CurrentTenantDb() db: TenantDb,
    @Param("channelId") channelId: string,
    @Body() body: unknown,
    @Req() req: HttpRequest,
  ): Promise<WhatsappProfileActionResponse> {
    const input = parseOrThrow(requestDisplayNameRequestSchema, body);
    const creds = await this.credentials(db, channelId);
    await this.client.requestDisplayName(creds, input.displayName);
    await this.audit(db, req, channelId, "channel.whatsapp_display_name_requested", { displayName: input.displayName });
    return { status: "ok" };
  }
}
