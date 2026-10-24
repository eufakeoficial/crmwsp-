import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, Put, Query, Req, Res, UseGuards } from "@nestjs/common";
import {
  NotFoundError,
  RateLimitedError,
  platformSupportListQuerySchema,
  platformSupportReplyRequestSchema,
  platformSupportUpdateRequestSchema,
  upsertSupportCannedResponseRequestSchema,
  uuidSchema,
  type PlatformSupportThread,
  type PlatformSupportTicket,
  type PlatformSupportTicketList,
  type SupportCannedResponse,
  type SupportUnread,
} from "@crmwsp/contracts";
import { CurrentUser } from "../auth/decorators.js";
import type { HttpRequest, RequestUser } from "../common/http.js";
import { parseOrThrow } from "../common/zod.js";
import { SSE_MAX_CONNECTIONS_PER_USER } from "../events/events.controller.js";
import { RealtimeHub } from "../events/realtime.hub.js";
import { openSseStream, type SseReply, type SseRequest } from "../events/sse.js";
import { PlatformAdminGuard } from "./platform-admin.guard.js";
import { PlatformSupportRepository } from "./platform-support.repository.js";

const ipOf = (req: HttpRequest): string | null => req.ip || null;

/**
 * Backoffice support inbox (ADR 0016). Same gate as the rest of /platform: non-admins get 404.
 * Replies and changes are pushed to the ticket's tenant stream and to the other admins.
 */
@Controller("platform/support")
@UseGuards(PlatformAdminGuard)
export class PlatformSupportController {
  private readonly streams = new Map<string, number>();

  constructor(
    @Inject(PlatformSupportRepository) private readonly repo: PlatformSupportRepository,
    @Inject(RealtimeHub) private readonly hub: RealtimeHub,
  ) {}

  private async notify(tenantId: string, ticketId: string): Promise<void> {
    const event = { type: "support.ticket_updated", ticketId } as const;
    await Promise.all([this.hub.publish(tenantId, event), this.hub.publishPlatformSupport(event)]);
  }

  private async thread(actor: string, ticketId: string): Promise<PlatformSupportThread> {
    const [ticket, messages] = await Promise.all([this.repo.get(actor, ticketId), this.repo.messages(actor, ticketId)]);
    return { ticket, messages };
  }

  @Get("tickets")
  async list(@CurrentUser() user: RequestUser, @Query() query: unknown): Promise<PlatformSupportTicketList> {
    return { items: await this.repo.list(user.id, parseOrThrow(platformSupportListQuerySchema, query)) };
  }

  @Get("unread-count")
  async unread(@CurrentUser() user: RequestUser): Promise<SupportUnread> {
    return { unreadCount: await this.repo.unreadCount(user.id) };
  }

  /** SSE of `support.ticket_updated` for every tenant (ids only). */
  @Get("events")
  async events(@CurrentUser() user: RequestUser, @Req() req: SseRequest, @Res() reply: SseReply): Promise<void> {
    const open = this.streams.get(user.id) ?? 0;
    if (open >= SSE_MAX_CONNECTIONS_PER_USER) throw new RateLimitedError("Too many open event streams");
    this.streams.set(user.id, open + 1);
    const release = (): void => {
      const n = (this.streams.get(user.id) ?? 1) - 1;
      if (n <= 0) this.streams.delete(user.id);
      else this.streams.set(user.id, n);
    };
    await openSseStream(req, reply, (l) => this.hub.subscribePlatformSupport(l), release);
  }

  /** Opening the thread clears the admin unread flag. */
  @Get("tickets/:id")
  async get(@CurrentUser() user: RequestUser, @Param("id") id: string): Promise<PlatformSupportThread> {
    const ticketId = parseOrThrow(uuidSchema, id);
    await this.repo.markRead(user.id, ticketId);
    return this.thread(user.id, ticketId);
  }

  @Post("tickets/:id/messages")
  async reply(@CurrentUser() user: RequestUser, @Req() req: HttpRequest, @Param("id") id: string, @Body() body: unknown): Promise<PlatformSupportThread> {
    const ticketId = parseOrThrow(uuidSchema, id);
    const input = parseOrThrow(platformSupportReplyRequestSchema, body);
    const tenantId = await this.repo.reply(user.id, ticketId, input.body, input.internal, ipOf(req));
    // Internal notes are invisible to the tenant: only the other admins are told.
    if (input.internal) await this.hub.publishPlatformSupport({ type: "support.ticket_updated", ticketId });
    else await this.notify(tenantId, ticketId);
    return this.thread(user.id, ticketId);
  }

  @Patch("tickets/:id")
  async update(@CurrentUser() user: RequestUser, @Req() req: HttpRequest, @Param("id") id: string, @Body() body: unknown): Promise<PlatformSupportTicket> {
    const ticketId = parseOrThrow(uuidSchema, id);
    const input = parseOrThrow(platformSupportUpdateRequestSchema, body);
    const assign = input.assignToMe === undefined ? undefined : input.assignToMe ? "me" : "none";
    const tenantId = await this.repo.update(user.id, ticketId, { status: input.status, priority: input.priority, assign }, ipOf(req));
    await this.notify(tenantId, ticketId);
    return this.repo.get(user.id, ticketId);
  }

  @Get("canned")
  async canned(@CurrentUser() user: RequestUser): Promise<{ items: SupportCannedResponse[] }> {
    return { items: await this.repo.cannedList(user.id) };
  }

  @Post("canned")
  createCanned(@CurrentUser() user: RequestUser, @Req() req: HttpRequest, @Body() body: unknown): Promise<SupportCannedResponse> {
    const input = parseOrThrow(upsertSupportCannedResponseRequestSchema, body);
    return this.repo.cannedUpsert(user.id, null, input.title, input.body, ipOf(req));
  }

  @Put("canned/:id")
  updateCanned(@CurrentUser() user: RequestUser, @Req() req: HttpRequest, @Param("id") id: string, @Body() body: unknown): Promise<SupportCannedResponse> {
    const input = parseOrThrow(upsertSupportCannedResponseRequestSchema, body);
    return this.repo.cannedUpsert(user.id, parseOrThrow(uuidSchema, id), input.title, input.body, ipOf(req));
  }

  @Delete("canned/:id")
  @HttpCode(204)
  async deleteCanned(@CurrentUser() user: RequestUser, @Req() req: HttpRequest, @Param("id") id: string): Promise<void> {
    if (!(await this.repo.cannedDelete(user.id, parseOrThrow(uuidSchema, id), ipOf(req)))) throw new NotFoundError();
  }
}
