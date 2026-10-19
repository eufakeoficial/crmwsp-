import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Keep in sync with SESSION_COOKIE in apps/api/src/auth/session-token.ts.
const SESSION_COOKIE = "__Host-crmwsp_session";

function adminPreviewEnabled(): boolean {
  return process.env.NODE_ENV !== "production" || process.env["ENABLE_ADMIN_PREVIEW"] === "1";
}

/** Presence check only: the API does the real validation (GET /auth/me). */
export function middleware(req: NextRequest) {
  // Backoffice preview has no superadmin role yet: hidden in production unless explicitly enabled.
  // The admin layout/page also call notFound(); this guarantees a real 404 status.
  const { pathname } = req.nextUrl;
  if ((pathname === "/app/admin" || pathname.startsWith("/app/admin/")) && !adminPreviewEnabled()) {
    return new NextResponse("Not Found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
  if (req.cookies.has(SESSION_COOKIE)) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = { matcher: ["/app", "/app/:path*"] };
