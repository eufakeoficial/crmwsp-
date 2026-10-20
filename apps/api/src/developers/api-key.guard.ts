import { createHash } from "node:crypto";
import { Inject, Injectable, SetMetadata, createParamDecorator, type CanActivate, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ForbiddenError, UnauthorizedError, type ApiKeyScope } from "@crmwsp/contracts";
import { apiKeys, eq, sql, withTenant } from "@crmwsp/db";
import { parseBearer } from "@crmwsp/domain";
import { DB_HANDLE, headerValue, type DbHandle, type HttpRequest } from "../common/http.js";

export const SCOPE_KEY = "crmwsp:api-scope";
/** Required scope of a public API handler (checked by ApiKeyGuard). */
export const RequireScope = (scope: ApiKeyScope) => SetMetadata(SCOPE_KEY, scope);

export interface ApiPrincipal {
  tenantId: string;
  apiKeyId: string;
  scopes: string[];
}

type ApiRequest = HttpRequest & { apiPrincipal?: ApiPrincipal };

export function hashApiKey(key: string): Buffer {
  return createHash("sha256").update(key, "utf8").digest();
}

/**
 * Authenticates `Authorization: Bearer <api key>`: SHA-256 of the key -> SECURITY DEFINER
 * `resolve_api_key` (no tenant context needed, no cross-tenant read). Unknown, revoked and
 * malformed keys all return the same 401. Fails closed when the route declares no scope.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    @Inject(DB_HANDLE) private readonly handle: DbHandle,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<ApiRequest>();
    const scope = this.reflector.getAllAndOverride<ApiKeyScope | undefined>(SCOPE_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (!scope) throw new ForbiddenError();
    const key = parseBearer(headerValue(req, "authorization"));
    if (!key) throw new UnauthorizedError("Invalid API key");
    const rows = await this.handle.db.execute<{ tenant_id: string; api_key_id: string; scopes: string[] }>(
      sql`select tenant_id, api_key_id, scopes from resolve_api_key(${hashApiKey(key)})`,
    );
    const row = rows[0];
    if (!row) throw new UnauthorizedError("Invalid API key");
    if (!row.scopes.includes(scope)) throw new ForbiddenError(`API key lacks scope ${scope}`);
    req.apiPrincipal = { tenantId: row.tenant_id, apiKeyId: row.api_key_id, scopes: row.scopes };
    // Best effort, throttled to one write per minute per key.
    await withTenant(this.handle.db, row.tenant_id, (tx) =>
      tx
        .update(apiKeys)
        .set({ lastUsedAt: sql`now()` })
        .where(sql`${eq(apiKeys.id, row.api_key_id)} and (${apiKeys.lastUsedAt} is null or ${apiKeys.lastUsedAt} < now() - interval '1 minute')`),
    ).catch(() => undefined);
    return true;
  }
}

export const CurrentApiPrincipal = createParamDecorator((_: unknown, ctx: ExecutionContext): ApiPrincipal => {
  const p = ctx.switchToHttp().getRequest<ApiRequest>().apiPrincipal;
  if (!p) throw new UnauthorizedError();
  return p;
});
