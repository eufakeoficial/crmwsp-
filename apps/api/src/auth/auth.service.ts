import { createHash } from "node:crypto";
import { Inject, Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { isDisposableEmail, normalizeSignupEmail } from "@crmwsp/domain";
import {
  ConflictError,
  ValidationError,
  type LoginRequest,
  type MeResponse,
  RateLimitedError,
  type SignupRequest,
  UnauthorizedError,
  type TenantId,
} from "@crmwsp/contracts";
import type { RequestUser } from "../common/http.js";
import { RATE_LIMIT_STORE, type CounterStore } from "../common/rate-limit-store.js";
import { AuthRepository, type UserTenantRow } from "./auth.repository.js";
import { SESSION_TTL_SECONDS } from "./auth.config.js";
import { hashPassword, verifyPassword } from "./password.js";
import {
  ACCOUNT_BACKOFF,
  AUTH_IP_RATE_LIMIT,
  AUTH_RATE_LIMIT,
  AccountBackoff,
  type BackoffOptions,
  type RateLimitOptions,
  StoreRateLimiter,
} from "./rate-limiter.js";
import { hashSessionToken, newSessionToken } from "./session-token.js";

export interface ClientInfo {
  ip: string | null;
  userAgent: string | null;
}

const isUniqueViolation = (err: unknown): boolean => (err as { code?: unknown } | null)?.code === "23505";

/** Pseudonymous email reference for logs/audit: sha256(lowercased email), first 16 hex chars. */
export const hashEmail = (email: string): string =>
  createHash("sha256").update(email.trim().toLowerCase(), "utf8").digest("hex").slice(0, 16);

const ua = (client: ClientInfo): string | null => client.userAgent?.slice(0, 200) ?? null;

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly logger = new Logger("Auth");
  private readonly limiter: StoreRateLimiter;
  private readonly ipLimiter: StoreRateLimiter;
  private readonly backoff: AccountBackoff;
  private dummyHash = "";

  constructor(
    @Inject(AuthRepository) private readonly repo: AuthRepository,
    @Inject(SESSION_TTL_SECONDS) readonly ttlSeconds: number,
    @Inject(AUTH_RATE_LIMIT) rateLimit: RateLimitOptions,
    @Inject(AUTH_IP_RATE_LIMIT) ipRateLimit: RateLimitOptions,
    @Inject(RATE_LIMIT_STORE) store: CounterStore,
    @Inject(ACCOUNT_BACKOFF) backoff: BackoffOptions,
  ) {
    this.limiter = new StoreRateLimiter(rateLimit, store, "auth");
    this.ipLimiter = new StoreRateLimiter(ipRateLimit, store, "auth");
    this.backoff = new AccountBackoff(store, backoff);
  }

  async onModuleInit(): Promise<void> {
    // Used to spend the same time verifying when the email does not exist.
    this.dummyHash = await hashPassword(newSessionToken());
  }

  async signup(input: SignupRequest, client: ClientInfo): Promise<{ token: string; userId: string }> {
    await this.limited("signup", input.email, client, async () => {
      await this.ipLimiter.consume(`ip:${client.ip ?? "-"}`);
      await this.limiter.consume(`signup:${client.ip ?? "-"}:${input.email}`);
    });
    // Trial anti-abuse (ADR 0015): throwaway inboxes cannot open accounts (new signups only).
    if (isDisposableEmail(input.email)) throw new ValidationError("Disposable email addresses are not allowed");
    const passwordHash = await hashPassword(input.password);
    let userId: string;
    let tenantId: string;
    try {
      ({ userId, tenantId } = await this.repo.signupTenant({
        email: input.email,
        name: input.name,
        passwordHash,
        tenantName: input.tenantName,
        tenantSlug: input.tenantSlug,
      }));
    } catch (err) {
      // Same answer for a taken email or slug: does not reveal which exists.
      if (isUniqueViolation(err)) throw new ConflictError("Signup could not be completed");
      throw err;
    }
    this.logger.log({ event: "auth.signup", userId, tenantId, ip: client.ip });
    // Multi-account signal for the platform backoffice: a flag only, never a block. Best effort.
    await this.repo.recordSignupSignals(tenantId, client.ip, normalizeSignupEmail(input.email)).catch((err: unknown) => {
      this.logger.warn(`signup signals not recorded (${err instanceof Error ? err.name : "unknown"})`);
    });
    // Referral (ADR 0017): best effort, never blocks the signup; rewarded only on the first payment.
    if (input.referralCode) {
      await this.repo.recordReferral(tenantId, input.referralCode).catch((err: unknown) => {
        this.logger.warn(`referral not recorded (${err instanceof Error ? err.name : "unknown"})`);
      });
    }
    await this.audit([tenantId], "auth.signup", userId, { ua: ua(client) }, client);
    return { token: await this.openSession(userId, client), userId };
  }

  async login(input: LoginRequest, client: ClientInfo): Promise<{ token: string; userId: string }> {
    const account = hashEmail(input.email);
    await this.limited("login", input.email, client, async () => {
      await this.ipLimiter.consume(`ip:${client.ip ?? "-"}`);
      await this.limiter.consume(`login:${client.ip ?? "-"}:${input.email}`);
      await this.backoff.check(account);
    });
    const row = await this.repo.findLogin(input.email);
    const ok = await verifyPassword(row?.passwordHash ?? this.dummyHash, input.password);
    if (!row || !ok) {
      const lockMs = await this.backoff.failure(account);
      this.logger.warn({ event: "auth.login_failed", email: account, ip: client.ip, ua: ua(client), knownUser: Boolean(row), lockMs });
      if (row) await this.auditUser(row.userId, "auth.login_failed", { email: account, ua: ua(client), lockMs }, client);
      throw new UnauthorizedError("Invalid email or password");
    }
    await this.backoff.success(account);
    return { token: await this.openSession(row.userId, client), userId: row.userId };
  }

  async logout(token: string | undefined, client: ClientInfo = { ip: null, userAgent: null }): Promise<void> {
    if (!token) return;
    const tokenHash = hashSessionToken(token);
    const session = await this.repo.resolveSession(tokenHash, this.ttlSeconds);
    await this.repo.revokeSession(tokenHash);
    if (session) {
      this.logger.log({ event: "auth.logout", userId: session.user.id, ip: client.ip });
      await this.auditUser(session.user.id, "auth.logout", { ua: ua(client) }, client);
    }
  }

  /** Validates a session token and slides its expiration (capped at 90 days from creation). */
  resolveSession(token: string): Promise<{ user: RequestUser; expiresAt: Date } | undefined> {
    return this.repo.resolveSession(hashSessionToken(token), this.ttlSeconds);
  }

  async resolve(token: string): Promise<RequestUser | undefined> {
    return (await this.resolveSession(token))?.user;
  }

  listTenants(userId: string): Promise<UserTenantRow[]> {
    return this.repo.listUserTenants(userId);
  }

  async me(user: RequestUser): Promise<MeResponse> {
    const tenants = await this.repo.listUserTenants(user.id);
    return {
      user: { id: user.id, email: user.email, name: user.name },
      tenants: tenants.map((t) => ({ ...t, id: t.id as TenantId })),
    };
  }

  /** Opens a session for a user created or verified elsewhere (e.g. invitation signup). */
  openSessionFor(userId: string, client: ClientInfo): Promise<string> {
    return this.openSession(userId, client);
  }

  /**
   * Runs the limit checks; a hit is logged (warn) before the 429 propagates. No DB lookup on this
   * path (a rate-limited flood must stay cheap), so auth.rate_limited is log-only.
   */
  private async limited(kind: "login" | "signup", email: string, client: ClientInfo, checks: () => Promise<void>): Promise<void> {
    try {
      await checks();
    } catch (err) {
      if (err instanceof RateLimitedError) {
        this.logger.warn({ event: "auth.rate_limited", kind, email: hashEmail(email), ip: client.ip, ua: ua(client) });
      }
      throw err;
    }
  }

  private async auditUser(userId: string, action: string, diff: Record<string, unknown>, client: ClientInfo): Promise<void> {
    try {
      const tenants = await this.repo.listUserTenants(userId);
      await this.audit(tenants.map((t) => t.id), action, userId, diff, client);
    } catch (err) {
      this.logger.warn({ event: "auth.audit_failed", action, error: (err as Error)?.name ?? "Error" });
    }
  }

  /** Best effort: an audit failure never changes the auth outcome. */
  private async audit(tenantIds: string[], action: string, userId: string, diff: Record<string, unknown>, client: ClientInfo): Promise<void> {
    try {
      await this.repo.writeAuthAudit(tenantIds, { action, userId, diff, ip: client.ip });
    } catch (err) {
      this.logger.warn({ event: "auth.audit_failed", action, error: (err as Error)?.name ?? "Error" });
    }
  }

  private async openSession(userId: string, client: ClientInfo): Promise<string> {
    const token = newSessionToken();
    await this.repo.createSession({
      userId,
      tokenHash: hashSessionToken(token),
      ip: client.ip,
      userAgent: client.userAgent,
      ttlSeconds: this.ttlSeconds,
    });
    return token;
  }
}
