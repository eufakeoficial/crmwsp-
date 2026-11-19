import { defineConfig, devices } from "@playwright/test";

// Dedicated port so the suite never collides with a developer's `pnpm dev` (3000).
const PORT = 3100;
const BASE_URL = `http://localhost:${PORT}`;

/**
 * Browser E2E for the web app. The API is ALWAYS mocked at the network layer
 * (page.route in tests/e2e/support.ts): no backend, DB or third party (Gupshup) is contacted.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env["CI"]),
  retries: process.env["CI"] ? 1 : 0,
  reporter: process.env["CI"] ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    locale: "es-ES",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `pnpm exec next dev --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env["CI"],
    timeout: 180_000,
    env: { NODE_ENV: "development", API_INTERNAL_URL: "http://127.0.0.1:9", NEXT_TELEMETRY_DISABLED: "1" },
  },
});
