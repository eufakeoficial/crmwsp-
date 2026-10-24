import { createHash } from "node:crypto";
import { Inject, Injectable, Logger, Optional, type OnModuleInit } from "@nestjs/common";
import {
  EMAIL_VERIFICATION_RESEND_LIMIT,
  EMAIL_VERIFICATION_TTL_HOURS,
  EMAIL_VERIFICATION_TTL_SECONDS,
  isDisposableEmail,
  normalizeSignupEmail,
} from "@crmwsp/domain";
import {
  ConflictError,
  ValidationError,
  type ForgotPasswordRequest,
  type LoginRequest,
  type ResetPasswordRequest,
  type VerifyEmailRequest,
  type MeResponse,
  RateLimitedError,
  type SignupRequest,
  UnauthorizedError,
  type TenantId,
} from "@crmwsp/contracts";
import { emailContextFromEnv, siteLink, templateMessage, type MailMessage, type Mailer } from "@crmwsp/mailer";
import type { RequestUser } from "../common/http.js";
import { RATE_LIMIT_STORE, type CounterStore } from "../common/rate-limit-store.js";
import { BusinessCategoryService } from "../settings/business-category.service.js";
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

/** Nest injection token of the auth mailer (welcome + password reset). */
export const AUTH_MAILER = Symbol("AUTH_MAILER");
/** Password reset links live 30 minutes. */
export const PASSWORD_RESET_TTL_SECONDS = 30 * 60;

const isUniqueViolation = (err: unknown): boolean => (err as { code?: unknown } | null)?.code === "23505";

/** Pseudonymous email reference for logs/audit: sha256(lowercased email), first 16 hex chars. */
/** Password reset requests per email (any IP): 3 per hour. */
export const FORGOT_PASSWORD_EMAIL_RATE_LIMIT = { limit: 3, windowMs: 60 * 60 * 1000 } as const;

export const hashEmail = (email: string): string =>
  createHash("sha256").update(email.trim().toLowerCase(), "utf8").digest("hex").slice(0, 16);

const ua = (client: ClientInfo): string | null => client.userAgent?.slice(0, 200) ?? null;

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly logger = new Logger("Auth");
  private readonly limiter: StoreRateLimiter;
  private readonly ipLimiter: StoreRateLimiter;
  /** Per email, independent of IP: caps reset mails a rotating-IP attacker can trigger. */
  private readonly forgotEmailLimiter: StoreRateLimiter;
  private readonly backoff: AccountBackoff;
  /** Per user: caps verification resends (3/hour). */
  private readonly resendVerificationLimiter: StoreRateLimiter;
  private dummyHash = "";

  constructor(
    @Inject(AuthRepository) private readonly repo: AuthRepository,
    @Inject(SESSION_TTL_SECONDS) readonly ttlSeconds: number,
    @Inject(AUTH_RATE_LIMIT) rateLimit: RateLimitOptions,
    @Inject(AUTH_IP_RATE_LIMIT) ipRateLimit: RateLimitOptions,
    @Inject(RATE_LIMIT_STORE) store: CounterStore,
    @Inject(ACCOUNT_BACKOFF) backoff: BackoffOptions,
    @Inject(AUTH_MAILER) private readonly mailer: Mailer,
    @Optional() @Inject(BusinessCategoryService) private readonly categories?: BusinessCategoryService,
  ) {
    this.limiter = new StoreRateLimiter(rateLimit, store, "auth");
    this.ipLimiter = new StoreRateLimiter(ipRateLimit, store, "auth");
    this.forgotEmailLimiter = new StoreRateLimiter(FORGOT_PASSWORD_EMAIL_RATE_LIMIT, store, "auth");
    this.backoff = new AccountBackoff(store, backoff);
    this.resendVerificationLimiter = new StoreRateLimiter(EMAIL_VERIFICATION_RESEND_LIMIT, store, "auth");
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
    // Business category (ADR 0021): a blocked rubro never gets an account; checked before creating it.
    if (input.businessCategory && this.categories) {
      const decision = await this.categories.decide(input.businessCategory);
      if (decision.outcome === "refused") throw new ValidationError(decision.message);
    }
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
    if (input.businessCategory && this.categories) {
      // Already validated above; a failure here leaves the category unset (the panel asks again).
      await this.categories.setForNewTenant(tenantId, input.businessCategory, input.businessCategoryDetail ?? null).catch((err: unknown) => {
        this.logger.warn(`business category not recorded (${err instanceof Error ? err.name : "unknown"})`);
      });
    }
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
    // Welcome + verification email after the signup committed; never blocks or fails the signup.
    await this.sendVerification(userId).catch((err: unknown) => {
      this.logger.warn(`verification email not issued (${err instanceof Error ? err.name : "unknown"})`);
    });
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

  /**
   * Starts a password reset. Same outcome for unknown emails (no user enumeration): the token is
   * stored hashed only for real password accounts and the email/audit run in the background so
   * the response time does not reveal whether the account exists.
   */
  async forgotPassword(input: ForgotPasswordRequest, client: ClientInfo): Promise<void> {
    await this.limited("forgot", input.email, client, async () => {
      await this.ipLimiter.consume(`ip:${client.ip ?? "-"}`);
      await this.limiter.consume(`forgot:${client.ip ?? "-"}:${input.email}`);
    });
    // Over the per-email cap the request is silently dropped (same 200 as always): no 429 that a
    // third party could use to block the owner's reset, and no mail flood from rotating IPs.
    if (!(await this.forgotEmailLimiter.hit(`forgot-email:${hashEmail(input.email)}`))) {
      this.logger.warn({ event: "auth.password_reset_email_limited", email: hashEmail(input.email), ip: client.ip });
      return;
    }
    const token = newSessionToken();
    const row = await this.repo.requestPasswordReset(input.email, hashSessionToken(token), PASSWORD_RESET_TTL_SECONDS, client.ip);
    this.logger.log({ event: "auth.password_reset_requested", email: hashEmail(input.email), ip: client.ip, knownUser: Boolean(row) });
    if (!row) return;
    void this.auditUser(row.userId, "auth.password_reset_requested", { ua: ua(client) }, client);
    const ctx = emailContextFromEnv();
    this.mailInBackground("recuperar-contrasena", () =>
      templateMessage(
        row.email,
        "recuperar-contrasena",
        { name: row.name ?? "", resetUrl: siteLink(ctx, `/reset/${token}`), minutes: PASSWORD_RESET_TTL_SECONDS / 60 },
        ctx,
      ),
    );
  }

  /** Sets a new password from a valid single-use token and revokes every session of the user. */
  async resetPassword(input: ResetPasswordRequest, client: ClientInfo): Promise<void> {
    await this.limited("reset", "", client, async () => {
      await this.ipLimiter.consume(`ip:${client.ip ?? "-"}`);
      await this.limiter.consume(`reset:${client.ip ?? "-"}`);
    });
    const passwordHash = await hashPassword(input.password);
    const userId = await this.repo.consumePasswordReset(hashSessionToken(input.token), passwordHash);
    if (!userId) throw new ValidationError("Invalid or expired reset link");
    this.logger.log({ event: "auth.password_reset", userId, ip: client.ip });
    await this.auditUser(userId, "auth.password_reset", { ua: ua(client), sessionsRevoked: true }, client);
  }

  /** Confirms the email from a valid single-use token (public link). */
  async verifyEmail(input: VerifyEmailRequest, client: ClientInfo): Promise<void> {
    await this.limited("verify", "", client, async () => {
      await this.ipLimiter.consume(`ip:${client.ip ?? "-"}`);
      await this.limiter.consume(`verify:${client.ip ?? "-"}`);
    });
    const userId = await this.repo.consumeEmailVerification(hashSessionToken(input.token));
    if (!userId) throw new ValidationError("Invalid or expired verification link");
    this.logger.log({ event: "auth.email_verified", userId, ip: client.ip });
    await this.auditUser(userId, "auth.email_verified", { ua: ua(client) }, client);
  }

  /** Sends a new verification link (previous ones stop working). 3 per hour per user. */
  async resendVerification(user: RequestUser, client: ClientInfo): Promise<void> {
    if (!(await this.resendVerificationLimiter.hit(`verify-resend:${user.id}`))) {
      this.logger.warn({ event: "auth.rate_limited", kind: "verify_resend", userId: user.id, ip: client.ip });
      throw new RateLimitedError();
    }
    await this.sendVerification(user.id);
  }

  /** Issues a hashed 24h token and mails the link; nothing for already verified users. */
  private async sendVerification(userId: string): Promise<void> {
    const token = newSessionToken();
    const row = await this.repo.issueEmailVerification(userId, hashSessionToken(token), EMAIL_VERIFICATION_TTL_SECONDS);
    if (!row) return;
    const ctx = emailContextFromEnv();
    this.mailInBackground("bienvenida-verificacion", () =>
      templateMessage(
        row.email,
        "bienvenida-verificacion",
        { name: row.name ?? "", verifyUrl: siteLink(ctx, `/verify/${token}`), hours: EMAIL_VERIFICATION_TTL_HOURS },
        ctx,
      ),
    );
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
    const [tenants, emailVerified] = await Promise.all([this.repo.listUserTenants(user.id), this.repo.isEmailVerified(user.id)]);
    return {
      user: { id: user.id, email: user.email, name: user.name, emailVerified },
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
  private async limited(kind: "login" | "signup" | "forgot" | "reset" | "verify", email: string, client: ClientInfo, checks: () => Promise<void>): Promise<void> {
    try {
      await checks();
    } catch (err) {
      if (err instanceof RateLimitedError) {
        this.logger.warn({ event: "auth.rate_limited", kind, email: hashEmail(email), ip: client.ip, ua: ua(client) });
      }
      throw err;
    }
  }

  /** Sends after the caller's work is done; a mail failure is only logged (never the address). */
  private mailInBackground(template: string, build: () => MailMessage): void {
    void Promise.resolve()
      .then(() => this.mailer.send(build()))
      .catch((err: unknown) => this.logger.warn({ event: "auth.email_failed", template, error: err instanceof Error ? err.name : "Error" }));
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
