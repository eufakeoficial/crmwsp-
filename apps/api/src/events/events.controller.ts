import type { IncomingMessage, ServerResponse } from "node:http";
import { Controller, Get, Inject, Query, Req, Res } from "@nestjs/common";
import { ForbiddenError, RateLimitedError, TENANT_HEADER, UnauthorizedError, ValidationError, tenantIdSchema } from "@crmwsp/contracts";
import { AuthService } from "../auth/auth.service.js";
import { type HttpRequest, headerValue } from "../common/http.js";
import { RealtimeHub } from "./realtime.hub.js";

/** Structural view of the Fastify request/reply bits used by SSE. */
interface SseRequest extends HttpRequest {
  raw: IncomingMessage;
}
interface SseReply {
  raw: ServerResponse;
  hijack(): void;
  getHeaders(): Record<string, unknown>;
}

export const SSE_HEARTBEAT_MS = 25_000;
/** Max concurrent SSE streams per user in this process (protects memory/sockets). */
export const SSE_MAX_CONNECTIONS_PER_USER = 5;

/**
 * GET /events: Server-Sent Events stream of `tenant:<id>:events` (ADR 0007).
 * Requires a session (global SessionGuard). The tenant comes from x-tenant-id or,
 * because EventSource cannot send headers, from ?tenantId= (only on this read-only
 * route); membership is checked exactly like TenantGuard.
 */
@Controller("events")
export class EventsController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(RealtimeHub) private readonly hub: RealtimeHub,
  ) {}

  private readonly perUser = new Map<string, number>();

  /** Open streams of a user in this process (tests/metrics). */
  connectionCount(userId: string): number {
    return this.perUser.get(userId) ?? 0;
  }

  @Get()
  async stream(
    @Req() req: SseRequest,
    @Res() reply: SseReply,
    @Query("tenantId") tenantQuery: string | undefined,
  ): Promise<void> {
    if (!req.user) throw new UnauthorizedError();
    const parsed = tenantIdSchema.safeParse(headerValue(req, TENANT_HEADER) ?? tenantQuery);
    if (!parsed.success) throw new ValidationError(`Missing or invalid ${TENANT_HEADER} header or tenantId query`);
    const membership = (await this.auth.listTenants(req.user.id)).find((t) => t.id === parsed.data);
    if (!membership) throw new ForbiddenError();
    const tenantId = membership.id;

    const userId = req.user.id;
    const open = this.perUser.get(userId) ?? 0;
    if (open >= SSE_MAX_CONNECTIONS_PER_USER) throw new RateLimitedError("Too many open event streams");
    this.perUser.set(userId, open + 1);
    const release = (): void => {
      const n = (this.perUser.get(userId) ?? 1) - 1;
      if (n <= 0) this.perUser.delete(userId);
      else this.perUser.set(userId, n);
    };

    const res = reply.raw;
    let closed = false;
    const state: { unsubscribe?: () => void; heartbeat?: NodeJS.Timeout } = {};
    const cleanup = (): void => {
      if (closed) return;
      closed = true;
      release();
      if (state.heartbeat) clearInterval(state.heartbeat);
      state.unsubscribe?.();
    };
    req.raw.on("close", cleanup);
    res.on("close", cleanup);

    // Subscribe before answering so no event published after the 200 is missed.
    let unsubscribe: () => void;
    try {
      unsubscribe = await this.hub.subscribe(tenantId, (event) => {
        if (!closed) res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      });
    } catch (err) {
      cleanup();
      throw err;
    }
    state.unsubscribe = unsubscribe;
    if (closed) {
      unsubscribe();
      return;
    }

    reply.hijack();
    const inherited: Record<string, string | string[]> = {};
    for (const [k, v] of Object.entries(reply.getHeaders())) {
      if (typeof v === "string" || Array.isArray(v)) inherited[k] = v as string | string[];
      else if (typeof v === "number") inherited[k] = String(v);
    }
    res.writeHead(200, {
      ...inherited,
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    res.write(`retry: 5000\n: connected\n\n`);
    state.heartbeat = setInterval(() => {
      if (!closed) res.write(`: ping\n\n`);
    }, SSE_HEARTBEAT_MS);
    state.heartbeat.unref();
  }
}
