import { type CanActivate, type ExecutionContext, Inject, Injectable } from "@nestjs/common";
import { NotFoundError } from "@crmwsp/contracts";
import { InMemoryRateLimiter, type RateLimitOptions } from "../auth/rate-limiter.js";
import type { HttpRequest } from "../common/http.js";
import { PlatformRepository } from "./platform.repository.js";

export const PLATFORM_RATE_LIMIT = Symbol("PLATFORM_RATE_LIMIT");
/** Per user across every admin-only /platform route. */
export const DEFAULT_PLATFORM_RATE_LIMIT: RateLimitOptions = { limit: 300, windowMs: 5 * 60 * 1000 };

/**
 * Runs after the global SessionGuard. Re-checks `platform_admins` on EVERY request (no cache, so a
 * revoke is immediate) and answers 404, never 403, so the panel's existence is not disclosed.
 */
@Injectable()
export class PlatformAdminGuard implements CanActivate {
  private readonly limiter: InMemoryRateLimiter;

  constructor(
    @Inject(PlatformRepository) private readonly repo: PlatformRepository,
    @Inject(PLATFORM_RATE_LIMIT) rateLimit: RateLimitOptions,
  ) {
    this.limiter = new InMemoryRateLimiter(rateLimit);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<HttpRequest>();
    if (!req.user) throw new NotFoundError();
    this.limiter.consume(`platform:${req.user.id}`);
    if (!(await this.repo.isAdmin(req.user.id))) throw new NotFoundError();
    return true;
  }
}
