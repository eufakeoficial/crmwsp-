import { configDefaults, defineConfig } from "vitest/config";

// platform.e2e flips the GLOBAL platform_settings.require_approval flag, which turns every signup made by a
// concurrently running file into a pending_approval tenant (403 on every call). It therefore runs alone, in a
// second invocation (CI: "Platform e2e (serial)") with PLATFORM_E2E_ONLY=1, after the parallel suite finishes.
const only = process.env["PLATFORM_E2E_ONLY"] === "1";

export default defineConfig({
  test: only
    ? { include: ["src/platform/platform.e2e.test.ts"] }
    : { exclude: [...configDefaults.exclude, "src/platform/platform.e2e.test.ts"] },
});
