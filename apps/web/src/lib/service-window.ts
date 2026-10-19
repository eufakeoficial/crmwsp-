import { SERVICE_WINDOW_MS } from "@crmwsp/contracts";

/**
 * Client-side hint for the WhatsApp 24 h customer service window. The server
 * decides with its own clock (422 OUTSIDE_SERVICE_WINDOW); this only warns early.
 */
export function isOutsideServiceWindow(lastInboundAt: string | null, now: number = Date.now()): boolean {
  if (lastInboundAt === null) return true;
  return now - new Date(lastInboundAt).getTime() > SERVICE_WINDOW_MS;
}
