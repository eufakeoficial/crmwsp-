import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "./app.module.js";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter());
  // Close Redis/DB/SSE cleanly on SIGTERM (container stop).
  app.enableShutdownHooks();
  const port = Number(process.env["API_PORT"] ?? process.env["PORT"] ?? 4000);
  await app.listen(port, "0.0.0.0");
}

void bootstrap();
