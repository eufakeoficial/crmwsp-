import type { IncomingMessage, ServerResponse } from "node:http";
import type { HttpRequest } from "../common/http.js";
import type { RealtimeListener } from "./realtime.hub.js";
import { SSE_HEARTBEAT_MS } from "./events.controller.js";

export interface SseRequest extends HttpRequest {
  raw: IncomingMessage;
}
export interface SseReply {
  raw: ServerResponse;
  hijack(): void;
  getHeaders(): Record<string, unknown>;
}

/**
 * Opens a Server-Sent Events stream fed by `subscribe` (same framing and heartbeat as
 * GET /events, ADR 0007). Subscribes before answering so no event after the 200 is missed;
 * `onClose` runs exactly once when the client goes away.
 */
export async function openSseStream(
  req: SseRequest,
  reply: SseReply,
  subscribe: (listener: RealtimeListener) => Promise<() => void>,
  onClose: () => void = () => undefined,
): Promise<void> {
  const res = reply.raw;
  let closed = false;
  const state: { unsubscribe?: () => void; heartbeat?: NodeJS.Timeout } = {};
  const cleanup = (): void => {
    if (closed) return;
    closed = true;
    onClose();
    if (state.heartbeat) clearInterval(state.heartbeat);
    state.unsubscribe?.();
  };
  req.raw.on("close", cleanup);
  res.on("close", cleanup);

  let unsubscribe: () => void;
  try {
    unsubscribe = await subscribe((event) => {
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
