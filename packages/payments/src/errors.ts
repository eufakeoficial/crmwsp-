import { AppError, ErrorCode, ExternalProviderError, type ExternalProvider } from "@crmwsp/contracts";

/** Provider failure with retry semantics. Never contains credentials or request bodies. */
export class PaymentProviderError extends ExternalProviderError {
  readonly retryable: boolean;
  readonly status?: number;
  /** Provider error code (e.g. Stripe `amount_too_small`), only if it looks like a plain slug. */
  readonly providerCode?: string;

  constructor(
    provider: ExternalProvider,
    message: string,
    retryable: boolean,
    extra: { status?: number; providerCode?: string } = {},
  ) {
    super(provider, message, extra.status === undefined ? undefined : { details: { status: extra.status } });
    this.retryable = retryable;
    if (extra.status !== undefined) this.status = extra.status;
    if (extra.providerCode !== undefined) this.providerCode = extra.providerCode;
  }
}

/** Webhook signature missing, malformed, mismatched or outside the tolerance window. 401. */
export class InvalidSignatureError extends AppError {
  constructor(message = "Invalid webhook signature") {
    super(ErrorCode.Unauthorized, message, 401);
  }
}
