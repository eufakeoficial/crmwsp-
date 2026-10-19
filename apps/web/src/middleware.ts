import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Keep in sync with SESSION_COOKIE in apps/api/src/auth/session-token.ts.
const SESSION_COOKIE = "__Host-crmwsp_session";

/** Presence check only: the API does the real validation (GET /auth/me). */
export function middleware(req: NextRequest) {
  if (req.cookies.has(SESSION_COOKIE)) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = { matcher: ["/app", "/app/:path*"] };
