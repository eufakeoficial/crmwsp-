import type { Page } from "@playwright/test";
import { CONTACT_ID, CONVERSATION_ID, channelFixture, conversationFixture, expect, test, type ApiMock } from "./support";

function mockBase(api: ApiMock) {
  api.on("GET", "/channels", () => ({ json: { items: [channelFixture()] } }));
  api.on("GET", "/channels/health", () => ({ json: { items: [] } }));
  api.on("GET", "/channels/360dialog/config", () => ({ json: { partnerId: null } }));
}

function mockSearch(api: ApiMock) {
  api.on("GET", "/contacts", () => ({
    json: { items: [{ id: CONTACT_ID, name: "María Pérez", phoneE164: "+5491166667777", tags: [], extracted: {}, createdAt: "2026-01-15T12:00:00.000Z", updatedAt: "2026-01-15T12:00:00.000Z" }] },
  }));
  api.on("GET", "/inbox/conversations", () => ({
    json: { items: [{ ...conversationFixture(), contact: { id: CONTACT_ID, name: "María Pérez", phoneE164: "+5491166667777" } }], nextCursor: null },
  }));
}

/** Retries the shortcut until React has hydrated the topbar listener. */
async function openWithShortcut(page: Page) {
  await expect(async () => {
    await page.keyboard.press("Control+k");
    await expect(page.getByRole("dialog", { name: "Buscar en el panel" })).toBeVisible({ timeout: 500 });
  }).toPass();
}

test.describe("Buscador del panel", () => {
  test("Ctrl+K abre el buscador, 'pagar' muestra Suscripción y Enter navega", async ({ page, api }) => {
    mockBase(api);
    await page.goto("/app/channels");
    await openWithShortcut(page);
    const dialog = page.getByRole("dialog", { name: "Buscar en el panel" });
    await expect(dialog).toBeVisible();
    await page.getByRole("combobox", { name: "Buscar" }).fill("pagar");
    await expect(dialog.getByRole("option", { name: /Suscripción/ }).first()).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/app\/settings\/billing$/);
  });

  test("Escape cierra y la lupa móvil/escritorio también lo abre", async ({ page, api }) => {
    mockBase(api);
    await page.goto("/app/channels");
    await expect(async () => {
      await page.getByRole("button", { name: "Buscar" }).click();
      await expect(page.getByRole("dialog", { name: "Buscar en el panel" })).toBeVisible({ timeout: 500 });
    }).toPass();
    await expect(page.getByRole("dialog", { name: "Buscar en el panel" })).toBeVisible();
    await expect(page.getByRole("option").first()).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Buscar en el panel" })).toBeHidden();
  });

  test("no consulta la API con 1 carácter y agrupa por debounce al escribir más", async ({ page, api }) => {
    mockBase(api);
    mockSearch(api);
    await page.goto("/app/channels");
    await openWithShortcut(page);
    const input = page.getByRole("combobox", { name: "Buscar" });
    await input.fill("m");
    await page.waitForTimeout(500);
    expect(api.requests.filter((r) => r.path === "/contacts" || r.path === "/inbox/conversations")).toHaveLength(0);
    await input.pressSequentially("ari", { delay: 30 });
    await expect(page.getByRole("option", { name: /María Pérez/ }).first()).toBeVisible();
    expect(api.requests.filter((r) => r.path === "/contacts")).toHaveLength(1);
    expect(api.requests.find((r) => r.path === "/contacts")).toBeDefined();
  });

  test("una conversación abre el inbox con ?conversation= y la última fila busca en el inbox", async ({ page, api }) => {
    mockBase(api);
    mockSearch(api);
    await page.goto("/app/channels");
    await openWithShortcut(page);
    await page.getByRole("combobox", { name: "Buscar" }).fill("maria");
    const dialog = page.getByRole("dialog", { name: "Buscar en el panel" });
    await expect(dialog.getByRole("option", { name: /Buscar «maria» en el inbox/ })).toBeVisible();
    await dialog.getByRole("option", { name: /Hola/ }).click();
    await expect(page).toHaveURL(new RegExp(`/app/inbox[?]conversation=${CONVERSATION_ID}$`));
  });

  test("fila 'Buscar en el inbox' navega con ?q=", async ({ page, api }) => {
    mockBase(api);
    mockSearch(api);
    await page.goto("/app/channels");
    await openWithShortcut(page);
    await page.getByRole("combobox", { name: "Buscar" }).fill("presupuesto enviado");
    await page.getByRole("option", { name: /Buscar «presupuesto enviado» en el inbox/ }).click();
    await expect(page).toHaveURL(/\/app\/inbox\?q=presupuesto%20enviado$/);
  });

  test("si las APIs fallan, las secciones siguen apareciendo", async ({ page, api }) => {
    mockBase(api);
    api.on("GET", "/contacts", () => ({ status: 500, json: { code: "X", message: "boom" } }));
    api.on("GET", "/inbox/conversations", () => ({ status: 500, json: { code: "X", message: "boom" } }));
    await page.goto("/app/channels");
    await openWithShortcut(page);
    await page.getByRole("combobox", { name: "Buscar" }).fill("suscripcion");
    await expect(page.getByRole("option", { name: /Suscripción/ }).first()).toBeVisible();
  });
});
