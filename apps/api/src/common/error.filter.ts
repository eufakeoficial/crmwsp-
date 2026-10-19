import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, Logger } from "@nestjs/common";
import {
  AppError,
  ForbiddenError,
  NotFoundError,
  RateLimitedError,
  UnauthorizedError,
  ValidationError,
  toErrorResponse,
} from "@crmwsp/contracts";
import type { HttpReply } from "./http.js";

/** Maps framework errors (Nest HttpException, Fastify 4xx) to AppError. */
function normalize(err: unknown): unknown {
  if (err instanceof AppError) return err;
  const status =
    err instanceof HttpException
      ? err.getStatus()
      : typeof (err as { statusCode?: unknown } | null)?.statusCode === "number"
        ? (err as { statusCode: number }).statusCode
        : undefined;
  switch (status) {
    case 400:
    case 413:
    case 415:
      return new ValidationError("Invalid request");
    case 401:
      return new UnauthorizedError();
    case 403:
      return new ForbiddenError();
    case 404:
      return new NotFoundError();
    case 429:
      return new RateLimitedError();
    default:
      return err;
  }
}

/** Global filter: every error response goes through toErrorResponse. */
@Catch()
export class AppErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger("AppErrorFilter");

  catch(exception: unknown, host: ArgumentsHost): void {
    const err = normalize(exception);
    const status = err instanceof AppError ? err.httpStatus : 500;
    if (status >= 500) {
      // Errors never carry passwords or tokens (only hashes are sent as bind params).
      this.logger.error(exception instanceof Error ? (exception.stack ?? exception.message) : "non-error thrown");
    }
    const reply = host.switchToHttp().getResponse<HttpReply>();
    reply.status(status).header("content-type", "application/json; charset=utf-8").send(toErrorResponse(err));
  }
}
