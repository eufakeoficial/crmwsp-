import type { DbHandle } from "@crmwsp/db";
import type { MembershipRole } from "@crmwsp/contracts";
import type { TenantDb } from "../db/tenant-db.js";

/** Authenticated user resolved from the session cookie. */
export interface RequestUser {
  id: string;
  email: string;
  name: string | null;
}

export interface RequestTenant {
  id: string;
  role: MembershipRole;
}

/**
 * Minimal view of the Fastify request/reply used by this app (fastify is a
 * transitive dependency of @nestjs/platform-fastify; we avoid importing it).
 */
export interface HttpRequest {
  headers: Record<string, string | string[] | undefined>;
  ip: string;
  method?: string;
  user?: RequestUser;
  tenant?: RequestTenant;
  tenantDb?: TenantDb;
  sessionTokenHash?: Buffer;
  sessionExpiresAt?: Date;
}

export interface HttpReply {
  header(name: string, value: string): HttpReply;
  status(code: number): HttpReply;
  send(payload?: unknown): unknown;
}

export const DB_HANDLE = Symbol("DB_HANDLE");
export type { DbHandle };

export function headerValue(req: HttpRequest, name: string): string | undefined {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
}
