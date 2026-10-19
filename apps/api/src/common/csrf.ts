import { ForbiddenError, TENANT_HEADER } from "@crmwsp/contracts";
import { type HttpRequest, headerValue } from "./http.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Comma-separated WEB_ORIGINS (e.g. "https://app.example.com"). */
export function allowedOriginsFromEnv(): string[] {
  return (process.env["WEB_ORIGINS"] ?? "")
    .split(",")
    .map((o) => o.trim().replace(/\/+$/, ""))
    .filter((o) => o.length > 0);
}

/**
 * Cheap CSRF defence in depth on top of SameSite=Lax (ADR 0006). A state
 * changing request passes when:
 * - it carries x-tenant-id (a non-safelisted header forces a CORS preflight,
 *   which this API never approves), or
 * - it is not flagged cross-site by Fetch Metadata and its Origin, if any, is
 *   in WEB_ORIGINS or equals the request Host. Requests without Origin come
 *   from non-browser clients (browsers always send Origin on POST).
 */
export function assertSameOriginForMutation(req: HttpRequest, allowed: readonly string[]): void {
  if (SAFE_METHODS.has((req.method ?? "GET").toUpperCase())) return;
  if ((headerValue(req, TENANT_HEADER) ?? "") !== "") return;
  if (headerValue(req, "sec-fetch-site") === "cross-site") throw new ForbiddenError();
  const origin = headerValue(req, "origin");
  if (origin === undefined) return;
  if (allowed.includes(origin)) return;
  const reqHost = headerValue(req, "host");
  let same = false;
  try {
    const o = new URL(origin);
    // Normalise default ports on both sides (Origin "http://x:80" == Host "x").
    same = reqHost !== undefined && o.host !== "" && o.host === new URL(`${o.protocol}//${reqHost}`).host;
  } catch {
    same = false;
  }
  if (same) return;
  throw new ForbiddenError();
}
