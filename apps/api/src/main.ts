import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "./app.module.js";
import { trustProxyHopsFromEnv } from "./common/client-ip.js";
import { registerSecurityHeaders } from "./common/security-headers.js";

async function bootstrap(): Promise<void> {
  if (!process.env["NODE_ENV"]) {
    // Fail safe: an unset NODE_ENV must never enable dev-only relaxations.
    new Logger("Bootstrap").error("NODE_ENV is not set; treating this process as production");
    process.env["NODE_ENV"] = "production";
  }
  // Railway edge = 1 hop on the public path; the web path is covered by the signed forward
  // (common/client-ip.ts), so req.ip is never taken from a client-supplied header blindly.
  const adapter = new FastifyAdapter({ trustProxy: trustProxyHopsFromEnv() });
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, {
    // Exact request bytes on req.rawBody: the Stripe webhook signature is computed over them.
    rawBody: true,
  });
  await registerSecurityHeaders(app);
  // Close Redis/DB/SSE cleanly on SIGTERM (container stop).
  app.enableShutdownHooks();
  const port = Number(process.env["API_PORT"] ?? process.env["PORT"] ?? 4000);
  await app.listen(port, "0.0.0.0");
}

void bootstrap();
