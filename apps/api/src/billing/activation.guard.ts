import { type CanActivate, type ExecutionContext, Inject, Injectable } from "@nestjs/common";
import { UnauthorizedError } from "@crmwsp/contracts";
import type { HttpRequest } from "../common/http.js";
import { PlanLimitsService } from "./plan-limits.service.js";

const READ_METHODS: ReadonlySet<string> = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Blocks writes (402 `SETUP_REQUIRED`) while a new tenant is still in setup, i.e. has not
 * connected its WhatsApp channel yet (ADR 0015). Reads stay allowed. Must run after TenantGuard:
 * `@UseGuards(TenantGuard, ActivationGuard)`.
 */
@Injectable()
export class ActivationGuard implements CanActivate {
  constructor(@Inject(PlanLimitsService) private readonly limits: Pick<PlanLimitsService, "assertNotInSetup">) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<HttpRequest>();
    if (READ_METHODS.has((req.method ?? "GET").toUpperCase())) return true;
    if (!req.tenant) throw new UnauthorizedError();
    await this.limits.assertNotInSetup(req.tenant.id);
    return true;
  }
}
