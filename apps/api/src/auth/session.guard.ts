import { type CanActivate, type ExecutionContext, Inject, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { UnauthorizedError } from "@crmwsp/contracts";
import { assertSameOriginForMutation, allowedOriginsFromEnv } from "../common/csrf.js";
import type { HttpReply, HttpRequest } from "../common/http.js";
import { AuthService } from "./auth.service.js";
import { PUBLIC_KEY, type PublicOptions } from "./decorators.js";
import { hashSessionToken, readSessionToken, setSessionCookie } from "./session-token.js";

/**
 * GLOBAL guard (APP_GUARD): every route requires a valid session unless it is
 * marked @Public(). Resolves the session cookie into request.user (401
 * otherwise) and applies the CSRF check to state-changing requests.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  private readonly allowedOrigins = allowedOriginsFromEnv();

  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== "http") return false;
    const http = context.switchToHttp();
    const req = http.getRequest<HttpRequest>();
    const pub = this.reflector.getAllAndOverride<PublicOptions | undefined>(PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (pub) {
      if (pub.sameOrigin) assertSameOriginForMutation(req, this.allowedOrigins);
      return true;
    }
    assertSameOriginForMutation(req, this.allowedOrigins);
    const token = readSessionToken(req);
    if (!token) throw new UnauthorizedError();
    const session = await this.auth.resolveSession(token);
    if (!session) throw new UnauthorizedError();
    req.user = session.user;
    req.sessionTokenHash = hashSessionToken(token);
    req.sessionExpiresAt = session.expiresAt;
    // Sliding expiration: refresh the cookie lifetime along with the DB row
    // (never beyond the absolute cap enforced by resolve_session).
    setSessionCookie(http.getResponse<HttpReply>(), token, maxAgeUntil(session.expiresAt, this.auth.ttlSeconds));
    return true;
  }
}

export function maxAgeUntil(expiresAt: Date, ttlSeconds: number, now = Date.now()): number {
  return Math.max(0, Math.min(ttlSeconds, Math.floor((expiresAt.getTime() - now) / 1000)));
}
