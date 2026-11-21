/*
 * Marketing tracking helpers (Meta Pixel + PostHog). Every function is a no-op unless the visitor
 * accepted cookies and the matching NEXT_PUBLIC_* variable was set at build time.
 */
import { getConsentSnapshot } from "./consent";

const rawPixelId = process.env["NEXT_PUBLIC_META_PIXEL_ID"]?.trim();
/** Pixel ids are numeric; anything else is ignored (it is embedded in an inline script). */
export const META_PIXEL_ID = rawPixelId && /^\d{5,20}$/.test(rawPixelId) ? rawPixelId : undefined;

export const POSTHOG_KEY = process.env["NEXT_PUBLIC_POSTHOG_KEY"]?.trim() || undefined;
export const POSTHOG_HOST = process.env["NEXT_PUBLIC_POSTHOG_HOST"]?.trim() || "https://us.i.posthog.com";

type Fbq = (...args: unknown[]) => void;
type PostHogLike = { capture: (event: string, props?: Record<string, unknown>) => void };

declare global {
  interface Window {
    fbq?: Fbq;
  }
}

type MetaCall = { event: string; data?: Record<string, unknown>; eventId?: string };
const metaQueue: MetaCall[] = [];
let posthogClient: PostHogLike | undefined;
const posthogQueue: { event: string; props?: Record<string, unknown> }[] = [];

export const hasConsent = (): boolean => getConsentSnapshot() === "accepted";

/** Inline snippet of the Meta Pixel base code (stub that queues until fbevents.js loads). */
export function metaPixelSnippet(pixelId: string): string {
  return `!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${pixelId}');`;
}

function sendMeta(call: MetaCall): void {
  if (call.eventId) window.fbq?.("track", call.event, call.data ?? {}, { eventID: call.eventId });
  else window.fbq?.("track", call.event, call.data ?? {});
}

/** Called when the pixel script is ready: replays events fired while it was still loading. */
export function flushMeta(): void {
  while (metaQueue.length > 0) sendMeta(metaQueue.shift()!);
}

export function trackMeta(event: string, eventId?: string, data?: Record<string, unknown>): void {
  if (!META_PIXEL_ID || !hasConsent()) return;
  const call: MetaCall = { event, ...(eventId ? { eventId } : {}), ...(data ? { data } : {}) };
  if (window.fbq) sendMeta(call);
  else metaQueue.push(call);
}

export function setPostHog(client: PostHogLike): void {
  posthogClient = client;
  while (posthogQueue.length > 0) {
    const item = posthogQueue.shift()!;
    client.capture(item.event, item.props);
  }
}

export function trackPostHog(event: string, props?: Record<string, unknown>): void {
  if (!POSTHOG_KEY || !hasConsent()) return;
  if (posthogClient) posthogClient.capture(event, props);
  else posthogQueue.push({ event, ...(props ? { props } : {}) });
}

/** Event id shared by the browser pixel and the server Conversions API for deduplication. */
export function newEventId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
  }
}

export function readCookie(name: string, cookieString: string): string | undefined {
  for (const part of cookieString.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=") || undefined;
  }
  return undefined;
}

/** Attribution payload for POST /auth/signup. Cookie ids are only read with consent. */
export function signupTracking(eventId: string): { consent: boolean; eventId: string; fbp?: string; fbc?: string } {
  const consent = hasConsent();
  if (!consent) return { consent, eventId };
  const fbp = readCookie("_fbp", document.cookie);
  const fbc = readCookie("_fbc", document.cookie);
  return { consent, eventId, ...(fbp ? { fbp } : {}), ...(fbc ? { fbc } : {}) };
}

/** Browser half of CompleteRegistration (the server sends the same event_id). */
export function trackRegistration(eventId: string): void {
  trackMeta("CompleteRegistration", eventId);
  trackPostHog("signup_completed");
}
