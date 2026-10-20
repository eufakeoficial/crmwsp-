import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import {
  ConflictError,
  type LoginRequest,
  type MeResponse,
  type SignupRequest,
  UnauthorizedError,
  type TenantId,
} from "@crmwsp/contracts";
import type { RequestUser } from "../common/http.js";
import { AuthRepository, type UserTenantRow } from "./auth.repository.js";
import { SESSION_TTL_SECONDS } from "./auth.config.js";
import { hashPassword, verifyPassword } from "./password.js";
import { AUTH_IP_RATE_LIMIT, AUTH_RATE_LIMIT, InMemoryRateLimiter, type RateLimitOptions } from "./rate-limiter.js";
import { hashSessionToken, newSessionToken } from "./session-token.js";

export interface ClientInfo {
  ip: string | null;
  userAgent: string | null;
}

const isUniqueViolation = (err: unknown): boolean => (err as { code?: unknown } | null)?.code === "23505";

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly limiter: InMemoryRateLimiter;
  private readonly ipLimiter: InMemoryRateLimiter;
  private dummyHash = "";

  constructor(
    @Inject(AuthRepository) private readonly repo: AuthRepository,
    @Inject(SESSION_TTL_SECONDS) readonly ttlSeconds: number,
    @Inject(AUTH_RATE_LIMIT) rateLimit: RateLimitOptions,
    @Inject(AUTH_IP_RATE_LIMIT) ipRateLimit: RateLimitOptions,
  ) {
    this.limiter = new InMemoryRateLimiter(rateLimit);
    this.ipLimiter = new InMemoryRateLimiter(ipRateLimit);
  }

  async onModuleInit(): Promise<void> {
    // Used to spend the same time verifying when the email does not exist.
    this.dummyHash = await hashPassword(newSessionToken());
  }

  async signup(input: SignupRequest, client: ClientInfo): Promise<{ token: string; userId: string }> {
    this.ipLimiter.consume(`ip:${client.ip ?? "-"}`);
    this.limiter.consume(`signup:${client.ip ?? "-"}:${input.email}`);
    const passwordHash = await hashPassword(input.password);
    let userId: string;
    try {
      ({ userId } = await this.repo.signupTenant({
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
    return { token: await this.openSession(userId, client), userId };
  }

  async login(input: LoginRequest, client: ClientInfo): Promise<{ token: string; userId: string }> {
    this.ipLimiter.consume(`ip:${client.ip ?? "-"}`);
    this.limiter.consume(`login:${client.ip ?? "-"}:${input.email}`);
    const row = await this.repo.findLogin(input.email);
    const ok = await verifyPassword(row?.passwordHash ?? this.dummyHash, input.password);
    if (!row || !ok) throw new UnauthorizedError("Invalid email or password");
    return { token: await this.openSession(row.userId, client), userId: row.userId };
  }

  async logout(token: string | undefined): Promise<void> {
    if (token) await this.repo.revokeSession(hashSessionToken(token));
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
