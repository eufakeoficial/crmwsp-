import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Keep in sync with SESSION_COOKIE in apps/api/src/auth/session-token.ts.
const SESSION_COOKIE = "__Host-crmwsp_session";
// Keep in sync with apps/api/src/common/client-ip.ts.
const CLIENT_IP_HEADER = "x-crmwsp-client-ip";
const PROXY_SIG_HEADER = "x-crmwsp-proxy-sig";

const hex = (buf: ArrayBuffer): string => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");

/** IP of the browser as seen by the Railway edge: it appends the client to X-Forwarded-For. */
function edgeClientIp(req: NextRequest): string | undefined {
  const xff = req.headers.get("x-forwarded-for");
  const last = xff?.split(",").map((s) => s.trim()).filter(Boolean).pop();
  return last ?? req.headers.get("x-real-ip")?.trim() ?? undefined;
}

/**
 * /api/* is rewritten to the API (next.config.ts). Forward the client IP signed with
 * INTERNAL_PROXY_SECRET (HMAC-SHA256 over "<ip>|<ts>") so the API can trust it; any incoming copy
 * of these headers is dropped first, so a browser cannot inject its own.
 */
async function forwardToApi(req: NextRequest): Promise<NextResponse> {
  const headers = new Headers(req.headers);
  headers.delete(CLIENT_IP_HEADER);
  headers.delete(PROXY_SIG_HEADER);
  const secret = process.env["INTERNAL_PROXY_SECRET"];
  const ip = edgeClientIp(req);
  if (secret && ip) {
    const ts = Date.now();
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${ip}|${ts}`));
    headers.set(CLIENT_IP_HEADER, ip);
    headers.set(PROXY_SIG_HEADER, `t=${ts},v=${hex(mac)}`);
  }
  return NextResponse.next({ request: { headers } });
}

/**
 * /app: presence check only; the API does the real validation (GET /auth/me).
 * The backoffice (/app/admin) is guarded by PlatformGate and the API's /platform/* 404s (ADR 0011).
 */
export async function middleware(req: NextRequest): Promise<NextResponse> {
  if (req.nextUrl.pathname.startsWith("/api/") || req.nextUrl.pathname === "/api") return forwardToApi(req);
  if (req.cookies.has(SESSION_COOKIE)) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = { matcher: ["/app", "/app/:path*", "/api/:path*"] };
