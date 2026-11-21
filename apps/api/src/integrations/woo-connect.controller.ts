import { Body, Controller, HttpCode, Inject, Post, Req, Res } from "@nestjs/common";
import { Public } from "../auth/decorators.js";
import { clientIp } from "../common/client-ip.js";
import type { HttpRequest } from "../common/http.js";
import { UNAUTHORIZED_MIN_MS } from "../webhooks/webhooks.controller.js";
import { WooConnectService } from "./woo-connect.service.js";

interface Reply {
  code(statusCode: number): Reply;
  send(payload?: unknown): unknown;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Called by the WordPress plugin; authenticated only by the single-use connect code in the body. */
@Public()
@Controller("public/woocommerce")
export class WooConnectController {
  constructor(@Inject(WooConnectService) private readonly service: WooConnectService) {}

  @Post("connect")
  @HttpCode(200)
  async connect(@Body() body: unknown, @Req() req: HttpRequest, @Res() reply: Reply): Promise<void> {
    const started = Date.now();
    const out = await this.service.connect(body, clientIp(req));
    if (out.kind === "invalid-code") {
      // Same constant-time-ish 401 as the commerce webhook: no hint about why the code failed.
      const jitter = Math.floor(Math.random() * 20);
      await sleep(Math.max(0, UNAUTHORIZED_MIN_MS + jitter - (Date.now() - started)));
      reply.code(401).send();
      return;
    }
    reply.code(200).send(out.result);
  }
}
