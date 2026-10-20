import { HttpAdapterHost } from "@nestjs/core";
import { Inject, Module } from "@nestjs/common";
import multipart from "@fastify/multipart";
import { AiModule } from "../ai/ai.module.js";
import { AuthModule } from "../auth/auth.module.js";
import { KnowledgeController, MAX_UPLOAD_BYTES } from "./knowledge.controller.js";

@Module({
  imports: [AuthModule, AiModule],
  controllers: [KnowledgeController],
})
export class KnowledgeModule {
  constructor(@Inject(HttpAdapterHost) host: HttpAdapterHost) {
    // Registered when the module is instantiated, before routes are bound, so it also works
    // for apps created with plain NestFactory.create (no changes needed in main.ts).
    const fastify = host.httpAdapter.getInstance() as { register(plugin: unknown, opts: unknown): unknown };
    fastify.register(multipart, {
      limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 4, parts: 6, fieldSize: 1024, headerPairs: 50 },
    });
  }
}
