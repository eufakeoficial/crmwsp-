import { z } from "zod";

export const ErrorCode = {
  ValidationError: "VALIDATION_ERROR",
  Unauthorized: "UNAUTHORIZED",
  Forbidden: "FORBIDDEN",
  NotFound: "NOT_FOUND",
  Conflict: "CONFLICT",
  RateLimited: "RATE_LIMITED",
  TenantContextMissing: "TENANT_CONTEXT_MISSING",
  ExternalProvider: "EXTERNAL_PROVIDER_ERROR",
  OutsideServiceWindow: "OUTSIDE_SERVICE_WINDOW",
  EncryptionNotConfigured: "ENCRYPTION_NOT_CONFIGURED",
  InsufficientStock: "INSUFFICIENT_STOCK",
  StorageNotConfigured: "STORAGE_NOT_CONFIGURED",
  PlanLimitExceeded: "PLAN_LIMIT_EXCEEDED",
  SetupRequired: "SETUP_REQUIRED",
  Internal: "INTERNAL_ERROR",
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export const errorCodeSchema = z.enum(Object.values(ErrorCode) as [ErrorCode, ...ErrorCode[]]);

export interface AppErrorOptions {
  details?: unknown;
  cause?: unknown;
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, httpStatus: number, options: AppErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
    this.code = code;
    this.httpStatus = httpStatus;
    if (options.details !== undefined) this.details = options.details;
  }
}

export class ValidationError extends AppError {
  constructor(message = "Validation failed", options?: AppErrorOptions) {
    super(ErrorCode.ValidationError, message, 400, options);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Unauthorized", options?: AppErrorOptions) {
    super(ErrorCode.Unauthorized, message, 401, options);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "Forbidden", options?: AppErrorOptions) {
    super(ErrorCode.Forbidden, message, 403, options);
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Not found", options?: AppErrorOptions) {
    super(ErrorCode.NotFound, message, 404, options);
  }
}

export class ConflictError extends AppError {
  constructor(message = "Conflict", options?: AppErrorOptions) {
    super(ErrorCode.Conflict, message, 409, options);
  }
}

/** The tenant's plan does not allow this (limit reached or feature not included). 402. */
export class PlanLimitExceededError extends AppError {
  constructor(message = "Plan limit exceeded", options?: AppErrorOptions) {
    super(ErrorCode.PlanLimitExceeded, message, 402, options);
  }
}

/** The tenant is still in setup: connect a WhatsApp channel to start the trial (ADR 0015). 402. */
export class SetupRequiredError extends AppError {
  constructor(message = "Connect your WhatsApp channel to start your trial", options?: AppErrorOptions) {
    super(ErrorCode.SetupRequired, message, 402, options);
  }
}

export class RateLimitedError extends AppError {
  constructor(message = "Too many requests", options?: AppErrorOptions) {
    super(ErrorCode.RateLimited, message, 429, options);
  }
}

/** Raised when a data access is attempted outside `withTenant`. */
export class TenantContextMissingError extends AppError {
  constructor(message = "Tenant context missing", options?: AppErrorOptions) {
    super(ErrorCode.TenantContextMissing, message, 500, options);
  }
}

export type ExternalProvider = "gupshup" | "360dialog" | "openai" | "stripe" | "mercadopago" | "nowpayments" | "s3" | "resend" | "smtp";

export class ExternalProviderError extends AppError {
  readonly provider: ExternalProvider;

  constructor(provider: ExternalProvider, message = "External provider error", options?: AppErrorOptions) {
    super(ErrorCode.ExternalProvider, message, 502, options);
    this.provider = provider;
  }
}

/**
 * 422: free-form messages are only allowed within 24 h of the contact's last inbound
 * message; outside it a template is required.
 */
export class OutsideServiceWindowError extends AppError {
  constructor(options?: AppErrorOptions) {
    super(ErrorCode.OutsideServiceWindow, "Outside the 24 h service window; a template is required", 422, options);
  }
}

/** 503: encryption master keys are not configured, so credentials cannot be handled. */
export class EncryptionNotConfiguredError extends AppError {
  constructor(
    message = "Encryption master keys are not configured; channel credentials are unavailable",
    options?: AppErrorOptions,
  ) {
    super(ErrorCode.EncryptionNotConfigured, message, 503, options);
  }
}

/** 409: not enough available stock to reserve an order; `details.variantId` names the variant. */
export class InsufficientStockError extends AppError {
  constructor(variantId: string, options: Omit<AppErrorOptions, "details"> = {}) {
    super(ErrorCode.InsufficientStock, "Insufficient stock", 409, { ...options, details: { variantId } });
  }
}

/** 503: object storage (S3_*) is not configured, so files cannot be stored or served. */
export class StorageNotConfiguredError extends AppError {
  constructor(message = "Object storage is not configured", options?: AppErrorOptions) {
    super(ErrorCode.StorageNotConfigured, message, 503, options);
  }
}

export const errorResponseSchema = z.object({
  code: errorCodeSchema,
  message: z.string(),
  details: z.unknown().optional(),
  requestId: z.string().optional(),
});
export type ErrorResponse = z.infer<typeof errorResponseSchema>;

/**
 * Maps any thrown value to the public error shape. Never exposes `stack` or `cause`.
 * Non-AppError values become a generic INTERNAL_ERROR without leaking their message.
 */
export function toErrorResponse(err: unknown, requestId?: string): ErrorResponse {
  const base: ErrorResponse =
    err instanceof AppError
      ? { code: err.code, message: err.message }
      : { code: ErrorCode.Internal, message: "Internal server error" };
  if (err instanceof AppError && err.details !== undefined) base.details = err.details;
  if (requestId !== undefined) base.requestId = requestId;
  return base;
}
