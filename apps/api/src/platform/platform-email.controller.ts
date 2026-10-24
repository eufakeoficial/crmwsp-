import { Body, Controller, Get, Inject, Param, Patch, Post, Query, Req, Res, UseGuards } from "@nestjs/common";
import {
  platformSupportUpdateRequestSchema,
  supportEmailComposeRequestSchema,
  supportEmailListQuerySchema,
  supportEmailReplyRequestSchema,
  uuidSchema,
  type SupportEmailThread,
  type SupportEmailThreadList,
  type SupportEmailUnread,
} from "@crmwsp/contracts";
import { z } from "zod";
import { CurrentUser } from "../auth/decorators.js";
import type { HttpRequest, RequestUser } from "../common/http.js";
import { parseOrThrow } from "../common/zod.js";
import { RealtimeHub } from "../events/realtime.hub.js";
import { PlatformAdminGuard } from "./platform-admin.guard.js";
import { PlatformEmailService } from "./platform-email.service.js";
import { PlatformSupportRepository } from "./platform-support.repository.js";

const ipOf = (req: HttpRequest): string | null => req.ip || null;
const attachmentIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);

interface FileReply {
  code(statusCode: number): FileReply;
  header(name: string, value: string): FileReply;
  send(payload?: unknown): unknown;
}

/**
 * Backoffice email inbox (ADR 0020) at /platform/support/email. Same gate as /platform
 * (non-admins get 404). Realtime goes through the existing platform:support:events channel.
 */
@Controller("platform/support/email")
@UseGuards(PlatformAdminGuard)
export class PlatformEmailController {
  constructor(
    @Inject(PlatformEmailService) private readonly email: PlatformEmailService,
    @Inject(PlatformSupportRepository) private readonly support: PlatformSupportRepository,
    @Inject(RealtimeHub) private readonly hub: RealtimeHub,
  ) {}

  @Get("threads")
  async list(@CurrentUser() user: RequestUser, @Query() query: unknown): Promise<SupportEmailThreadList> {
    const { folder } = parseOrThrow(supportEmailListQuerySchema, query);
    return { items: await this.email.list(user.id, folder) };
  }

  @Get("unread-count")
  async unread(@CurrentUser() user: RequestUser): Promise<SupportEmailUnread> {
    return { unreadCount: await this.email.unreadCount(user.id) };
  }

  @Get("threads/:id")
  thread(@CurrentUser() user: RequestUser, @Param("id") id: string): Promise<SupportEmailThread> {
    return this.email.thread(user.id, parseOrThrow(uuidSchema, id), true);
  }

  @Post("threads/:id/reply")
  reply(@CurrentUser() user: RequestUser, @Req() req: HttpRequest, @Param("id") id: string, @Body() body: unknown): Promise<SupportEmailThread> {
    const input = parseOrThrow(supportEmailReplyRequestSchema, body);
    return this.email.reply(user.id, parseOrThrow(uuidSchema, id), input.body, ipOf(req));
  }

  @Post("compose")
  compose(@CurrentUser() user: RequestUser, @Req() req: HttpRequest, @Body() body: unknown): Promise<SupportEmailThread> {
    const input = parseOrThrow(supportEmailComposeRequestSchema, body);
    return this.email.compose(user.id, input.to, input.subject, input.body, ipOf(req));
  }

  /** Status / priority / assignment, reusing the audited platform_support_update. */
  @Patch("threads/:id")
  async update(@CurrentUser() user: RequestUser, @Req() req: HttpRequest, @Param("id") id: string, @Body() body: unknown): Promise<SupportEmailThread> {
    const ticketId = parseOrThrow(uuidSchema, id);
    const input = parseOrThrow(platformSupportUpdateRequestSchema, body);
    const assign = input.assignToMe === undefined ? undefined : input.assignToMe ? "me" : "none";
    await this.email.thread(user.id, ticketId, false); // 404 unless it is an email thread
    await this.support.update(user.id, ticketId, { status: input.status, priority: input.priority, assign }, ipOf(req));
    await this.hub.publishPlatformSupport({ type: "support.ticket_updated", ticketId });
    return this.email.thread(user.id, ticketId, false);
  }

  @Get("threads/:id/attachments/:attachmentId")
  async attachment(
    @CurrentUser() user: RequestUser,
    @Param("id") id: string,
    @Param("attachmentId") attachmentId: string,
    @Res() reply: FileReply,
  ): Promise<void> {
    const file = await this.email.attachment(user.id, parseOrThrow(uuidSchema, id), parseOrThrow(attachmentIdSchema, attachmentId));
    const safeName = file.filename.replace(/[^\w.\- ]+/g, "_").slice(0, 120) || "adjunto";
    reply
      .header("content-type", "application/octet-stream")
      .header("content-disposition", `attachment; filename="${safeName}"`)
      .header("x-content-type-options", "nosniff")
      .header("cache-control", "private, no-store")
      .code(200)
      .send(file.body);
  }
}
