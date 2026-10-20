import { randomUUID } from "node:crypto";

/** Minimal Redis surface for the lock (ioredis satisfies it). */
export interface LockRedis {
  set(key: string, value: string, px: "PX", ms: number, nx: "NX"): Promise<"OK" | null>;
  eval(script: string, numKeys: number, ...args: Array<string | number>): Promise<unknown>;
}

/** Deletes the key only if it still holds our token (never frees someone else's lock). */
const RELEASE_SCRIPT = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`;

export class LockTimeoutError extends Error {
  constructor() {
    super("timed out waiting for the conversation lock");
    this.name = "LockTimeoutError";
  }
}

export interface LockOptions {
  /** Lock TTL; must exceed the worst-case turn (embedding + two LLM calls). */
  ttlMs?: number;
  /** How long to wait for a busy lock before failing (BullMQ retries the job). */
  waitMs?: number;
  pollMs?: number;
}

/**
 * Runs `fn` holding a Redis lock (`SET NX PX` + random token, released with a compare-and-delete
 * Lua script). Holds no database connection while waiting or while `fn` awaits the LLM.
 */
export async function withRedisLock<T>(redis: LockRedis, key: string, fn: () => Promise<T>, opts: LockOptions = {}): Promise<T> {
  const { ttlMs = 180_000, waitMs = 120_000, pollMs = 50 } = opts;
  const token = randomUUID();
  const deadline = Date.now() + waitMs;
  while ((await redis.set(key, token, "PX", ttlMs, "NX")) !== "OK") {
    if (Date.now() >= deadline) throw new LockTimeoutError();
    await new Promise((r) => setTimeout(r, pollMs));
  }
  try {
    return await fn();
  } finally {
    await redis.eval(RELEASE_SCRIPT, 1, key, token).catch(() => undefined);
  }
}
