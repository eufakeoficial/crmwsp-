import { expect, test, type ApiMock } from "./support";

const chat = {
  purpose: "chat",
  provider: "openrouter",
  baseUrl: "https://openrouter.ai/api/v1",
  apiKeyHint: "••••rout",
  modelCheap: "openai/gpt-4o-mini",
  modelStrong: "openai/gpt-4o",
  capabilities: { structuredOutput: true, embeddings: false, transcription: false },
  lastTestedAt: "2026-11-01T10:00:00.000Z",
  lastTestOk: true,
  monthlyBudgetMinor: null,
  budgetCurrency: null,
};
const dedicated = {
  purpose: "transcription",
  provider: "openai",
  baseUrl: "https://api.openai.com/v1",
  apiKeyHint: "••••1234",
  model: "whisper-1",
  lastTestedAt: null,
  lastTestOk: null,
};

function mockSettings(api: ApiMock) {
  api.on("GET", "/ai/connection", () => ({ json: chat }));
  api.on("GET", "/ai/usage", () => ({ json: { spentMinor: 0, currency: "USD", budgetMinor: null, currencyMismatch: false, estimated: false, byKind: [] } }));
  api.on("GET", "/ai/agent-config", () => ({ json: { systemPrompt: "", aiModeDefault: "assist", confidenceThreshold: 0.75, approvalThresholdMinor: null } }));
}

test.describe("Transcripción de audios (opcional)", () => {
  test("OpenRouter sin key de audio: no disponible; guardar, probar y activar", async ({ page, api }) => {
    mockSettings(api);
    let state: { connection: unknown; source: string } = { connection: null, source: "none" };
    api.on("GET", "/ai/transcription-connection", () => ({ json: state }));
    api.on("PUT", "/ai/transcription-connection", () => {
      state = { connection: dedicated, source: "none" };
      return { json: dedicated };
    });
    api.on("POST", "/ai/transcription-connection/test", () => {
      state = { connection: { ...dedicated, lastTestOk: true, lastTestedAt: "2026-11-20T10:00:00.000Z" }, source: "dedicated" };
      return { json: { ok: true, latencyMs: 40 } };
    });
    await page.goto("/app/settings/ai");

    const card = page.getByTestId("transcription-card");
    await expect(card.getByText("Transcripción de audios (opcional)")).toBeVisible();
    await expect(card.getByTestId("transcription-status")).toHaveText("Audios: no disponibles");
    await expect(card.getByRole("link", { name: "platform.openai.com/api-keys" })).toHaveAttribute("href", "https://platform.openai.com/api-keys");
    const key = card.getByLabel("API key de OpenAI");
    await expect(key).toHaveAttribute("autocomplete", "new-password");
    await expect(key).toHaveAttribute("data-lpignore", "true");

    await key.fill("sk-audio-secret-9999");
    await card.getByRole("button", { name: "Guardar" }).click();
    await expect(card.getByText("Guardada. Pulsa «Probar» para activarla.")).toBeVisible();
    await expect(key).toHaveValue("");
    const put = api.requests.find((r) => r.method === "PUT" && r.path === "/ai/transcription-connection");
    expect(put?.body).toEqual({ provider: "openai", model: "whisper-1", apiKey: "sk-audio-secret-9999" });

    await card.getByRole("button", { name: "Probar" }).click();
    await expect(card.getByTestId("transcription-status")).toHaveText("Audios: activos (con esta conexión de transcripción)");
  });

  test("quitar la conexión vuelve a no disponible", async ({ page, api }) => {
    mockSettings(api);
    let state: { connection: unknown; source: string } = { connection: { ...dedicated, lastTestOk: true }, source: "dedicated" };
    api.on("GET", "/ai/transcription-connection", () => ({ json: state }));
    api.on("DELETE", "/ai/transcription-connection", () => {
      state = { connection: null, source: "none" };
      return { status: 204, json: null };
    });
    await page.goto("/app/settings/ai");
    const card = page.getByTestId("transcription-card");
    await expect(card.getByTestId("transcription-status")).toHaveText("Audios: activos (con esta conexión de transcripción)");
    await card.getByRole("button", { name: "Quitar" }).click();
    await expect(card.getByTestId("transcription-status")).toHaveText("Audios: no disponibles");
  });
});
