import {
  TENANT_HEADER,
  type ErrorCode,
  type LoginRequest,
  type SignupRequest,
  errorResponseSchema,
  meResponseSchema,
  tenantMembersResponseSchema,
} from "@crmwsp/contracts";
import type { z } from "zod";

export type ApiErrorCode = ErrorCode | "NETWORK_ERROR" | "INVALID_RESPONSE";

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ApiErrorCode, message: string, status: number, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    if (details !== undefined) this.details = details;
  }
}

const BASE = "/api";
let activeTenantId: string | null = null;

/** Tenant sent as x-tenant-id on every request until changed. */
export function setActiveTenantId(id: string | null): void {
  activeTenantId = id;
}

export function getActiveTenantId(): string | null {
  return activeTenantId;
}

export interface RequestOptions<S extends z.ZodType | undefined> {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  /** Query string params; undefined values are skipped. */
  query?: Record<string, string | number | undefined>;
  /** Response schema; omit for empty (204) responses. */
  schema?: S;
}

function withQuery(path: string, query: RequestOptions<undefined>["query"]): string {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== "") params.set(k, String(v));
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

export async function request<S extends z.ZodType | undefined = undefined>(
  path: string,
  { method = "GET", body, schema, query }: RequestOptions<S> = {},
): Promise<S extends z.ZodType ? z.output<S> : undefined> {
  const headers: Record<string, string> = { accept: "application/json" };
  const isForm = typeof FormData !== "undefined" && body instanceof FormData;
  // Multipart bodies set their own boundary header; JSON otherwise.
  if (body !== undefined && !isForm) headers["content-type"] = "application/json";
  if (activeTenantId !== null) headers[TENANT_HEADER] = activeTenantId;

  let res: Response;
  try {
    res = await fetch(`${BASE}${withQuery(path, query)}`, {
      method,
      headers,
      credentials: "include",
      ...(body !== undefined ? { body: isForm ? (body as FormData) : JSON.stringify(body) } : {}),
    });
  } catch {
    throw new ApiError("NETWORK_ERROR", "Network request failed", 0);
  }

  if (!res.ok) throw await toApiError(res);
  if (schema === undefined) return undefined as never;

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new ApiError("INVALID_RESPONSE", "Response is not valid JSON", res.status);
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new ApiError("INVALID_RESPONSE", "Unexpected response shape", res.status);
  return parsed.data as never;
}

async function toApiError(res: Response): Promise<ApiError> {
  try {
    const parsed = errorResponseSchema.safeParse(await res.json());
    if (parsed.success) return new ApiError(parsed.data.code, parsed.data.message, res.status, parsed.data.details);
  } catch {
    // Not JSON: fall through to the status-based error.
  }
  // Fallback by status (non-JSON body or an unknown code).
  const code: ApiErrorCode =
    res.status === 401
      ? "UNAUTHORIZED"
      : res.status === 403
        ? "FORBIDDEN"
        : "INTERNAL_ERROR";
  return new ApiError(code, `Request failed with status ${res.status}`, res.status);
}

export const api = {
  signup: (input: SignupRequest) => request("/auth/signup", { method: "POST", body: input, schema: meResponseSchema }),
  login: (input: LoginRequest) => request("/auth/login", { method: "POST", body: input, schema: meResponseSchema }),
  logout: () => request("/auth/logout", { method: "POST" }),
  me: () => request("/auth/me", { schema: meResponseSchema }),
  members: () => request("/tenant/members", { schema: tenantMembersResponseSchema }),
};
