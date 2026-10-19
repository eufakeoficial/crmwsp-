import { Module } from "@nestjs/common";
import { AuthController } from "./auth.controller.js";
import { SESSION_TTL_SECONDS, sessionTtlSecondsFromEnv } from "./auth.config.js";
import { AuthRepository } from "./auth.repository.js";
import { AuthService } from "./auth.service.js";
import { APP_GUARD } from "@nestjs/core";
import {
  AUTH_IP_RATE_LIMIT,
  AUTH_RATE_LIMIT,
  DEFAULT_AUTH_IP_RATE_LIMIT,
  DEFAULT_AUTH_RATE_LIMIT,
} from "./rate-limiter.js";
import { SessionGuard } from "./session.guard.js";
import { TenantGuard } from "./tenant.guard.js";

@Module({
  controllers: [AuthController],
  providers: [
    AuthRepository,
    AuthService,
    SessionGuard,
    TenantGuard,
    { provide: SESSION_TTL_SECONDS, useFactory: sessionTtlSecondsFromEnv },
    { provide: AUTH_RATE_LIMIT, useValue: DEFAULT_AUTH_RATE_LIMIT },
    { provide: AUTH_IP_RATE_LIMIT, useValue: DEFAULT_AUTH_IP_RATE_LIMIT },
    // Session required by default on every route; opt out with @Public().
    { provide: APP_GUARD, useExisting: SessionGuard },
  ],
  exports: [AuthService, SessionGuard, TenantGuard],
})
export class AuthModule {}
