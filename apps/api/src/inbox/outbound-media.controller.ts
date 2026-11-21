import { randomUUID } from "node:crypto";
import { Body, Controller, HttpCode, Inject, Param, Post, Req, UseGuards } from "@nestjs/common";
import { MAX_IMAGE_BYTES, ConflictError, NotFoundError, OutsideServiceWindowError, SERVICE_WINDOW_MS, ValidationError, sendMediaMessageRequestSchema, type Message, type OutboundMediaUploadResponse } from "@crmwsp/contracts";
import { attachments, contacts, conversations, eq, isUuid, messages, sql, type Transaction } from "@crmwsp/db";
import { pauseAfterAgentReply } from "@crmwsp/domain";
import type { Queue } from "bullmq";
import { CurrentTenant, CurrentTenantDb, Roles } from "../auth/decorators.js";
import { TenantGuard } from "../auth/tenant.guard.js";
import type { HttpRequest, RequestTenant } from "../common/http.js";
import type { TenantDb } from "../db/tenant-db.js";
import { PlanLimitsService } from "../billing/plan-limits.service.js";
import { sniffImage } from "../commerce/media.controller.js";
import { parseOrThrow } from "../common/zod.js";
import { RealtimeHub } from "../events/realtime.hub.js";
import { StorageHolder } from "../storage/object-storage.js";
import { writeAudit } from "./audit.js";
import { withAttachments } from "./inbox.queries.js";
import { assertConversationVisible, loadInboxSettings } from "./inbox-v2.scope.js";
import { OUTBOUND_QUEUE, SEND_MESSAGE_JOB, SEND_MESSAGE_JOB_OPTIONS, type SendMessageJobData } from "./outbound.constants.js";

const SIGNED_URL_TTL_SECONDS = 300;

const messageColumns = {
  id: messages.id,
  conversationId: messages.conversationId,
  direction: messages.direction,
  type: messages.type,
  body: messages.body,
  status: messages.status,
  author: messages.author,
  authorUserId: messages.authorUserId,
  clientMessageId: messages.clientMessageId,
  error: messages.error,
  reaction: messages.reaction,
  reactionBy: messages.reactionBy,
  sentAt: messages.sentAt,
  createdAt: messages.createdAt,
};

async function pauseAutomationsAfterAgentReply(tx: Transaction, tenantId: string, contactId: string): Promise<void> {
  const settings = await loadInboxSettings(tx, tenantId);
  if (settings.pauseAutomationOnAgentReplyMinutes <= 0) return;
  const [ct] = await tx
    .select({ until: contacts.automationsPausedUntil })
    .from(contacts)
    .where(eq(contacts.id, contactId))
    .for("update");
  if (!ct) return;
  const next = pauseAfterAgentReply(ct.until, new Date(), settings.pauseAutomationOnAgentReplyMinutes);
  if (next && next.getTime() !== ct.until?.getTime()) {
    await tx.update(contacts).set({ automationsPausedUntil: next }).where(eq(contacts.id, contactId));
  }
}


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
    @Inject(OUTBOUND_QUEUE) private readonly queue: Queue,
    @Inject(RealtimeHub) private readonly hub: RealtimeHub,
  ) {}

  @Post(":id/media-messages")
  @Roles("owner", "admin", "agent")
  @HttpCode(202)
  async send(
    @CurrentTenantDb() db: TenantDb,
    @CurrentTenant() tenant: RequestTenant,
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() req: HttpRequest,
  ): Promise<Message> {
    if (!isUuid(id)) throw new NotFoundError();
    const input = parseOrThrow(sendMediaMessageRequestSchema, body);

    const key = "tenants/" + db.tenantId + "/outbound/" + id + "/" + input.uploadId + "." + (input.mime === "image/jpeg" ? "jpg" : "png");

    const { message, created } = await db.run(async (tx) => {
      // A subscription restricted past grace (ADR 0013) cannot send, not even manually.
      await this.planLimits.assertSubscriptionActive(db.tenantId, tx);
      await assertConversationVisible(tx, db.tenantId, tenant.role, db.userId, id);
      const findExisting = async () => {
        const [row] = await tx
          .select(messageColumns)
          .from(messages)
          .where(eq(messages.clientMessageId, input.clientMessageId));
        return row;
      };
      const [conv] = await tx
        .select({
          id: conversations.id,
          contactId: conversations.contactId,
          // Evaluated with the database clock, never the client's (nor this host's).
          inWindow: sql<boolean>`coalesce(${conversations.lastInboundAt} > now() - make_interval(secs => ${SERVICE_WINDOW_MS / 1000}), false)`,
        })
        .from(conversations)
        .where(eq(conversations.id, id));
      if (!conv) throw new NotFoundError();

      // Idempotent retry: answer with the original message, whatever the window says now.
      const existing = await findExisting();
      if (existing) {
        if (existing.conversationId !== id) throw new ConflictError("clientMessageId already used");
        return { message: existing, created: false };
      }

      if (!conv.inWindow) {
        throw new OutsideServiceWindowError();
      }

      if (!(await this.storage.require().exists(key))) throw new NotFoundError("Uploaded image not found");

      const [inserted] = await tx
        .insert(messages)
        .values({
          tenantId: db.tenantId,
          conversationId: id,
          direction: "outbound",
          type: "image",
          body: input.caption ?? null,
          status: "queued",
          author: "user",
          authorUserId: db.userId,
          clientMessageId: input.clientMessageId,
        })
        .onConflictDoNothing({
          target: [messages.tenantId, messages.clientMessageId],
          where: sql`${messages.clientMessageId} is not null`,
        })
        .returning(messageColumns);
      if (!inserted) {
        // Concurrent duplicate committed first.
        const dup = await findExisting();
        if (!dup || dup.conversationId !== id) throw new ConflictError("clientMessageId already used");
        return { message: dup, created: false };
      }
      await tx.insert(attachments).values({ tenantId: db.tenantId, messageId: inserted.id, storageKey: key, mimeType: input.mime, sizeBytes: null });
      await tx
        .update(conversations)
        .set({
          lastMessageAt: sql`greatest(coalesce(${conversations.lastMessageAt}, ${inserted.createdAt.toISOString()}::timestamptz), ${inserted.createdAt.toISOString()}::timestamptz)`,
          updatedAt: new Date(),
        })
        .where(eq(conversations.id, id));
      await pauseAutomationsAfterAgentReply(tx, db.tenantId, conv.contactId);
      await writeAudit(tx, { tenantId: db.tenantId, userId: db.userId, entity: "conversation", entityId: id, action: "message.media_sent", diff: { messageId: inserted.id, uploadId: input.uploadId, mime: input.mime }, ip: req.ip });
      return { message: inserted, created: true };
    });

    if (message.status === "queued") {
      // Also re-enqueued on idempotent retries: recovers a lost enqueue; jobId dedupes in BullMQ.
      const data: SendMessageJobData = { tenantId: db.tenantId, messageId: message.id };
      await this.queue.add(SEND_MESSAGE_JOB, data, { ...SEND_MESSAGE_JOB_OPTIONS, jobId: message.id });
    }
    if (created) {
      await this.hub.publish(db.tenantId, { type: "message.created", conversationId: id, messageId: message.id });
    }
    const [dto] = await db.run((tx) => withAttachments(tx, [message]));
    if (!dto) throw new NotFoundError();
    return dto;
  }
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
