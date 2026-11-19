import { CHANNEL_ID, TENANT_ID, USER_ID, channelFixture, expect, test, type ApiMock } from "./support";

const SECRET = "sk_live_REVEALED_abcdef123456";
const REVEAL_PATH = `/channels/${CHANNEL_ID}/reveal-api-key`;

function mockChannels(api: ApiMock) {
  api.on("GET", "/channels", () => ({ json: { items: [channelFixture()] } }));
  api.on("GET", "/channels/health", () => ({ json: { items: [] } }));
  api.on("GET", "/channels/360dialog/config", () => ({ json: { partnerId: null } }));
  api.on("GET", `/channels/${CHANNEL_ID}/balance`, () => ({ json: { status: "unavailable" } }));
}

test.describe("Mostrar API key del canal (solo dueño)", () => {
  test("contraseña incorrecta: muestra el error y no revela nada", async ({ page, api }) => {
    mockChannels(api);
    api.on("POST", REVEAL_PATH, () => ({ status: 403, json: { code: "FORBIDDEN", message: "No pudimos confirmar tu identidad." } }));
    await page.goto("/app/channels");
    const card = page.getByTestId("channel-card");
    await card.getByRole("button", { name: "Mostrar API key" }).click();
    const pw = card.getByLabel("Confirma tu contraseña");
    await expect(pw).toHaveAttribute("autocomplete", "off");
    await expect(pw).toHaveAttribute("data-lpignore", "true");
    await pw.fill("mala-clave");
    await card.getByRole("button", { name: "Mostrar", exact: true }).click();
    await expect(card.getByText("La contraseña no es correcta.")).toBeVisible();
    await expect(pw).toHaveValue("");
    await expect(card.getByTestId("revealed-api-key")).toHaveCount(0);
  });

  test("demasiados intentos: mensaje de una hora", async ({ page, api }) => {
    mockChannels(api);
    api.on("POST", REVEAL_PATH, () => ({ status: 429, json: { code: "RATE_LIMITED", message: "Too many requests" } }));
    await page.goto("/app/channels");
    const card = page.getByTestId("channel-card");
    await card.getByRole("button", { name: "Mostrar API key" }).click();
    await card.getByLabel("Confirma tu contraseña").fill("lo-que-sea");
    await card.getByRole("button", { name: "Mostrar", exact: true }).click();
    await expect(card.getByText("Demasiados intentos. Prueba en una hora.")).toBeVisible();
  });

  test("contraseña correcta: muestra la key 30 s con cuenta atrás y luego la borra del DOM", async ({ page, api, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.clock.install();
    mockChannels(api);
    api.on("POST", REVEAL_PATH, () => ({ json: { apiKey: SECRET, expiresInSeconds: 30 } }));
    await page.goto("/app/channels");
    const card = page.getByTestId("channel-card");
    await card.getByRole("button", { name: "Mostrar API key" }).click();
    await card.getByLabel("Confirma tu contraseña").fill("buena-clave");
    await card.getByRole("button", { name: "Mostrar", exact: true }).click();

    await expect(card.getByTestId("revealed-api-key")).toHaveValue(SECRET);
    await expect(card.getByTestId("reveal-countdown")).toHaveText("Se ocultará en 30 segundos");
    const sent = api.requests.find((r) => r.method === "POST" && r.path === REVEAL_PATH);
    expect(sent?.body).toEqual({ password: "buena-clave" });

    await card.getByTestId("reveal-api-key-panel").getByRole("button", { name: "Copiar" }).click();
    await expect(page.getByText("API key copiada")).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(SECRET);

    await page.clock.runFor(10_000);
    await expect(card.getByTestId("reveal-countdown")).toHaveText("Se ocultará en 20 segundos");
    await page.clock.runFor(21_000);
    await expect(card.getByTestId("revealed-api-key")).toHaveCount(0);
    expect(await page.content()).not.toContain(SECRET);
    expect(await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }) + location.href)).not.toContain(SECRET);
  });

  test("un administrador no ve el botón", async ({ page, api }) => {
    mockChannels(api);
    api.on("GET", "/auth/me", () => ({
      json: {
        user: { id: USER_ID, email: "admin@example.test", name: "Admin E2E", emailVerified: true },
        tenants: [{ id: TENANT_ID, slug: "e2e", name: "Negocio E2E", role: "admin", status: "active" }],
      },
    }));
    await page.goto("/app/channels");
    const card = page.getByTestId("channel-card");
    await expect(card.getByRole("button", { name: "Rotar token" })).toBeVisible();
    await expect(card.getByRole("button", { name: "Mostrar API key" })).toHaveCount(0);
  });
});
