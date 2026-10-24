import { Module } from "@nestjs/common";
import { APP_GUARD, HttpAdapterHost } from "@nestjs/core";
import { installClientIpHook } from "../common/client-ip.js";
import { RATE_LIMIT_STORE, defaultRateLimitStore } from "../common/rate-limit-store.js";
import { AuthController } from "./auth.controller.js";
import { SESSION_TTL_SECONDS, sessionTtlSecondsFromEnv } from "./auth.config.js";
import { AuthRepository } from "./auth.repository.js";
import { createMailerFromEnv } from "@crmwsp/mailer";
import { AUTH_MAILER, AuthService } from "./auth.service.js";
import {
  ACCOUNT_BACKOFF,
  AUTH_IP_RATE_LIMIT,
  AUTH_RATE_LIMIT,
  DEFAULT_ACCOUNT_BACKOFF,
  DEFAULT_AUTH_IP_RATE_LIMIT,
  DEFAULT_AUTH_RATE_LIMIT,
} from "./rate-limiter.js";
import { SessionGuard } from "./session.guard.js";
import { TenantGuard } from "./tenant.guard.js";
import { BusinessCategoryService } from "../settings/business-category.service.js";

const CLIENT_IP_HOOK = Symbol("CLIENT_IP_HOOK");

@Module({
  controllers: [AuthController],
  providers: [
    AuthRepository,
    AuthService,
    BusinessCategoryService,
    SessionGuard,
    TenantGuard,
    { provide: SESSION_TTL_SECONDS, useFactory: sessionTtlSecondsFromEnv },
    { provide: AUTH_RATE_LIMIT, useValue: DEFAULT_AUTH_RATE_LIMIT },
    { provide: AUTH_IP_RATE_LIMIT, useValue: DEFAULT_AUTH_IP_RATE_LIMIT },
    { provide: ACCOUNT_BACKOFF, useValue: DEFAULT_ACCOUNT_BACKOFF },
    { provide: RATE_LIMIT_STORE, useFactory: defaultRateLimitStore },
    { provide: AUTH_MAILER, useFactory: () => createMailerFromEnv() },
    // Pins request.ip to the real client IP (common/client-ip.ts) on every route.
    {
      provide: CLIENT_IP_HOOK,
      useFactory: (host: HttpAdapterHost) => installClientIpHook(host.httpAdapter?.getInstance?.()),
      inject: [HttpAdapterHost],
    },
    // Session required by default on every route; opt out with @Public().
    { provide: APP_GUARD, useExisting: SessionGuard },
  ],
  exports: [AuthService, BusinessCategoryService, SessionGuard, TenantGuard, RATE_LIMIT_STORE, CLIENT_IP_HOOK],
})
export class AuthModule {}
