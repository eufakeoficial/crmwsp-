import { HttpAdapterHost } from "@nestjs/core";
import { Inject, Module } from "@nestjs/common";
import multipart from "@fastify/multipart";

/** Hard ceiling of any upload; each endpoint applies its own (smaller) limit on top. */
export const MULTIPART_MAX_BYTES = 15 * 1024 * 1024;

/**
 * Registers @fastify/multipart exactly once (Nest modules are singletons), before routes are
 * bound. Import it from every module whose controllers read `req.parts()`.
 */
@Module({})
export class MultipartModule {
  constructor(@Inject(HttpAdapterHost) host: HttpAdapterHost) {
    const fastify = host.httpAdapter.getInstance() as { register(plugin: unknown, opts: unknown): unknown };
    fastify.register(multipart, {
      limits: { fileSize: MULTIPART_MAX_BYTES, files: 1, fields: 4, parts: 6, fieldSize: 1024, headerPairs: 50 },
    });
  }
}
