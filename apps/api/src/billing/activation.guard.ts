import { type CanActivate, type ExecutionContext, Inject, Injectable, Optional, SetMetadata } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { UnauthorizedError } from "@crmwsp/contracts";
import type { HttpRequest } from "../common/http.js";
import { PlanLimitsService } from "./plan-limits.service.js";

const READ_METHODS: ReadonlySet<string> = new Set(["GET", "HEAD", "OPTIONS"]);

export const ALLOW_LAPSED_WRITE = "activation:allow-lapsed-write";

/**
 * Marks a write that must keep working when the subscription lapsed (e.g. cancelling a scheduled
 * broadcast, a read-only POST preview). Setup is still enforced.
 */
export const AllowLapsedWrite = (): MethodDecorator & ClassDecorator => SetMetadata(ALLOW_LAPSED_WRITE, true);

/**
 * Guards business writes by access state (ADR 0015):
 *  - `setup` → 402 `SETUP_REQUIRED` (connect WhatsApp first);
 *  - `restricted` / `payment_required` → 402 `PLAN_LIMIT_EXCEEDED` with reason
 *    `subscription_restricted` / `trial_already_used` (pay to continue);
 *  - `trial`, `active`, `grace` and `unbilled` (grandfathered, never billed) pass.
 * Reads always pass; billing, settings, auth and exports are not behind this guard.
 * Must run after TenantGuard: `@UseGuards(TenantGuard, ActivationGuard)`.
 */
@Injectable()
export class ActivationGuard implements CanActivate {
  constructor(
    @Inject(PlanLimitsService) private readonly limits: Pick<PlanLimitsService, "assertNotInSetup" | "assertSubscriptionActive">,
    @Optional() @Inject(Reflector) private readonly reflector?: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<HttpRequest>();
    if (READ_METHODS.has((req.method ?? "GET").toUpperCase())) return true;
    if (!req.tenant) throw new UnauthorizedError();
    const lapsedOk = this.reflector?.getAllAndOverride<boolean>(ALLOW_LAPSED_WRITE, [context.getHandler(), context.getClass()]) === true;
    if (lapsedOk) await this.limits.assertNotInSetup(req.tenant.id);
    else await this.limits.assertSubscriptionActive(req.tenant.id);
    return true;
  }
}
