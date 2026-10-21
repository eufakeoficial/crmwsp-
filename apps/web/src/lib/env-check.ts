/*
 * Boot-time environment assertions for the web app. Imported (side effect) from next.config.ts,
 * so it runs on `next build`, `next start` and `next dev`.
 *
 * - CN-011: an unset/unknown NODE_ENV is treated as production (dev allowances stay off).
 * - CN-017: in production, API_INTERNAL_URL must be set; never fall back to localhost silently.
 */

type Env = Record<string, string | undefined>;

/** Dev allowances require NODE_ENV to be explicitly "development" or "test". */
export function isDevOrTestEnv(nodeEnv: string | undefined = process.env.NODE_ENV): boolean {
  return nodeEnv === "development" || nodeEnv === "test";
}

/** Next CLI subcommand (`build`, `start`, `dev`, `lint`...) when loaded through the CLI. */
function nextCommand(argv: readonly string[] = process.argv): string | undefined {
  return argv.slice(2).find((a) => !a.startsWith("-"));
}

/**
 * Throws when the server would run as production without API_INTERNAL_URL. Tooling that only
 * loads the config (e.g. `next lint`, which Next runs as NODE_ENV=production) is not a server
 * boot and is not blocked.
 */
export function assertWebEnv(env: Env = process.env, command: string | undefined = nextCommand()): void {
  if (command === "lint" || command === "info" || command === "telemetry") return;
  const nodeEnv = env["NODE_ENV"];
  if (nodeEnv === undefined || nodeEnv === "") {
    console.error("[env] NODE_ENV is not set: treating the web app as production.");
  }
  if (!isDevOrTestEnv(nodeEnv) && !env["API_INTERNAL_URL"]) {
    throw new Error("API_INTERNAL_URL must be set in production (refusing to fall back to localhost).");
  }
}

assertWebEnv();
