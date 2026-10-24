import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res } from "@nestjs/common";
import {
  type MeResponse,
  forgotPasswordRequestSchema,
  loginRequestSchema,
  resetPasswordRequestSchema,
  signupRequestSchema,
  verifyEmailRequestSchema,
} from "@crmwsp/contracts";
import { type HttpReply, type HttpRequest, type RequestUser, headerValue } from "../common/http.js";
import { clientIp } from "../common/client-ip.js";
import { parseOrThrow } from "../common/zod.js";
import { AuthService, type ClientInfo } from "./auth.service.js";
import { CurrentUser, Public } from "./decorators.js";
import { clearSessionCookie, readSessionToken, setSessionCookie } from "./session-token.js";

const clientInfo = (req: HttpRequest): ClientInfo => ({
  ip: clientIp(req),
  userAgent: headerValue(req, "user-agent") ?? null,
});

@Controller("auth")
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Post("signup")
  @Public({ sameOrigin: true })
  @HttpCode(201)
  async signup(
    @Body() body: unknown,
    @Req() req: HttpRequest,
    @Res({ passthrough: true }) reply: HttpReply,
  ): Promise<MeResponse> {
    const input = parseOrThrow(signupRequestSchema, body);
    const { token, userId } = await this.auth.signup(input, clientInfo(req));
    setSessionCookie(reply, token, this.auth.ttlSeconds);
    return this.auth.me({ id: userId, email: input.email, name: input.name });
  }

  @Post("login")
  @Public({ sameOrigin: true })
  @HttpCode(200)
  async login(
    @Body() body: unknown,
    @Req() req: HttpRequest,
    @Res({ passthrough: true }) reply: HttpReply,
  ): Promise<MeResponse> {
    const input = parseOrThrow(loginRequestSchema, body);
    const { token } = await this.auth.login(input, clientInfo(req));
    setSessionCookie(reply, token, this.auth.ttlSeconds);
    const user = await this.auth.resolve(token);
    if (!user) throw new Error("session not found right after login");
    return this.auth.me(user);
  }

  /** Always 200 with the same body: never reveals whether the email has an account. */
  @Post("password/forgot")
  @Public({ sameOrigin: true })
  @HttpCode(200)
  async forgotPassword(@Body() body: unknown, @Req() req: HttpRequest): Promise<{ ok: true }> {
    await this.auth.forgotPassword(parseOrThrow(forgotPasswordRequestSchema, body), clientInfo(req));
    return { ok: true };
  }

  /** Every session of the user is revoked, including the caller's cookie. */
  @Post("password/reset")
  @Public({ sameOrigin: true })
  @HttpCode(200)
  async resetPassword(
    @Body() body: unknown,
    @Req() req: HttpRequest,
    @Res({ passthrough: true }) reply: HttpReply,
  ): Promise<{ ok: true }> {
    await this.auth.resetPassword(parseOrThrow(resetPasswordRequestSchema, body), clientInfo(req));
    clearSessionCookie(reply);
    return { ok: true };
  }

  /** Public: the link from the verification email. 400 VALIDATION_ERROR when invalid/expired/used. */
  @Post("verify-email")
  @Public({ sameOrigin: true })
  @HttpCode(200)
  async verifyEmail(@Body() body: unknown, @Req() req: HttpRequest): Promise<{ ok: true }> {
    await this.auth.verifyEmail(parseOrThrow(verifyEmailRequestSchema, body), clientInfo(req));
    return { ok: true };
  }

  /** Authenticated: mails a new verification link (max 3 per hour per user). */
  @Post("resend-verification")
  @HttpCode(200)
  async resendVerification(@CurrentUser() user: RequestUser, @Req() req: HttpRequest): Promise<{ ok: true }> {
    await this.auth.resendVerification(user, clientInfo(req));
    return { ok: true };
  }

  // Public so an expired session can still clear its cookie; it only revokes
  // the session whose token it presents. CSRF: SameSite=Lax + Origin check.
  @Post("logout")
  @Public({ sameOrigin: true })
  @HttpCode(204)
  async logout(@Req() req: HttpRequest, @Res({ passthrough: true }) reply: HttpReply): Promise<void> {
    await this.auth.logout(readSessionToken(req), clientInfo(req));
    clearSessionCookie(reply);
  }

  @Get("me")
  me(@CurrentUser() user: RequestUser): Promise<MeResponse> {
    return this.auth.me(user);
  }
}
