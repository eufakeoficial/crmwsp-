import type { Page } from "@playwright/test";
import { CHANNEL_ID, WEBHOOK_TOKEN, WEBHOOK_URL, channelFixture, expect, test, type ApiMock } from "./support";

function mockChannels(api: ApiMock, items: unknown[], health: unknown[] = []) {
  api.on("GET", "/channels", () => ({ json: { items } }));
  api.on("GET", "/channels/health", () => ({ json: { items: health } }));
  api.on("GET", "/channels/360dialog/config", () => ({ json: { partnerId: null } }));
  api.on("GET", `/channels/${CHANNEL_ID}/balance`, () => ({ json: { status: "unavailable" } }));
}

async function openConnectForm(page: Page) {
  await page.goto("/app/channels");
  await expect(page.getByRole("heading", { name: "Conectar WhatsApp (Gupshup)" })).toBeVisible();
}

async function fillForm(page: Page) {
  await page.getByLabel("Teléfono (formato internacional)").fill("+5491155551234");
  await page.getByLabel("Nombre de la app en Gupshup").fill("MiEmpresaApp");
  await page.getByLabel("API key de Gupshup").fill("sk_test_SECRET_9876543210");
}

test.describe("Conectar canal de WhatsApp (Gupshup)", () => {
  test("conecta el canal y muestra Activo, la clave enmascarada y la URL de webhook", async ({ page, api, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    mockChannels(api, []);
    api.on("POST", "/channels/gupshup", () => ({ status: 201, json: channelFixture() }));
    await openConnectForm(page);

    await fillForm(page);
    await page.getByRole("button", { name: "Conectar canal" }).click();

    const card = page.getByTestId("connect-channel-panel");
    await expect(card.getByText("••••1234")).toBeVisible();
    await expect(card.getByTestId("webhook-url")).toHaveText(WEBHOOK_URL);
    const channelCard = page.getByTestId("channel-card");
    await expect(channelCard.getByText("Activo")).toBeVisible();
    await expect(channelCard.getByText("••••1234")).toBeVisible();

    const sent = api.requests.find((r) => r.method === "POST" && r.path === "/channels/gupshup");
    expect(sent?.body).toMatchObject({ phoneE164: "+5491155551234", appName: "MiEmpresaApp" });
    expect(sent?.headers["x-tenant-id"]).toBeTruthy();

    await channelCard.getByRole("button", { name: "Copiar" }).click();
    await expect(page.getByText("URL copiada")).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(WEBHOOK_URL);
  });

  test("el campo API key desactiva el autocompletado del navegador", async ({ page, api }) => {
    mockChannels(api, []);
    await openConnectForm(page);
    // Regression: Chrome autofill was overwriting the key with a saved password.
    await expect(page.getByLabel("API key de Gupshup")).toHaveAttribute("autocomplete", "new-password");
  });

  test("credenciales inválidas: muestra el error y no crea tarjeta", async ({ page, api }) => {
    mockChannels(api, []);
    api.on("POST", "/channels/gupshup", () => ({
      status: 400,
      json: { code: "VALIDATION_ERROR", message: "Bad request", details: { reason: "gupshup_invalid_credentials" } },
    }));
    await openConnectForm(page);

    await fillForm(page);
    await page.getByRole("button", { name: "Conectar canal" }).click();

    await expect(page.getByText("La API key no es válida para esa cuenta de Gupshup.")).toBeVisible();
    await expect(page.getByTestId("channel-card")).toHaveCount(0);
  });

  test("ID de app sin token de Partner: pide completar ambos o ninguno y no llama a la API", async ({ page, api }) => {
    mockChannels(api, []);
    await openConnectForm(page);

    await fillForm(page);
    await page.getByLabel(/ID de app de Gupshup/).fill("app-1234-abcd");
    await page.getByRole("button", { name: "Conectar canal" }).click();

    await expect(page.getByText(/completa el ID de app y el token de Partner, o deja ambos vacíos/)).toBeVisible();
    expect(api.requests.some((r) => r.method === "POST" && r.path === "/channels/gupshup")).toBe(false);
  });

  test("la tarjeta muestra el último envío fallido con su error", async ({ page, api }) => {
    mockChannels(api, [channelFixture()], [
      { channelId: CHANNEL_ID, lastInboundAt: null, lastOutbound: { ok: false, at: new Date().toISOString(), error: "Authentication Failed" } },
    ]);
    await page.goto("/app/channels");

    const outbound = page.getByTestId("channel-health-outbound");
    await expect(outbound).toContainText("falló");
    await expect(outbound).toContainText("Authentication Failed");
  });

  test("«Hacerlo con IA: configurar el webhook» no copia la API key ni el token del webhook", async ({ page, api, context }) => {
    // The webhook token is a secret (security review): the prompt asks the user to paste the URL instead.
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    mockChannels(api, [channelFixture()]);
    await page.goto("/app/channels");

    await page.getByRole("button", { name: "Hacerlo con IA: configurar el webhook" }).click();
    await expect(page.getByText("Prompt copiado", { exact: false })).toBeVisible();

    const prompt = await page.evaluate(() => navigator.clipboard.readText());
    expect(prompt).not.toContain("sk_test_SECRET");
    expect(prompt).not.toContain(WEBHOOK_TOKEN);
    expect(prompt).not.toContain(WEBHOOK_URL);
  });
});
