import type { Page } from "@playwright/test";
import { CONVERSATION_ID, conversationFixture, expect, test, type ApiMock } from "./support";

type Fixture = ReturnType<typeof conversationFixture>;

function mockInbox(api: ApiMock, current: Fixture) {
  api.on("GET", "/inbox/conversations", () => ({ json: { items: [current], nextCursor: null } }));
  api.on("GET", `/inbox/conversations/${CONVERSATION_ID}`, () => ({ json: current }));
  api.on("GET", "/inbox/counts", () => ({
    json: { open: 1, closed: 0, unread: 0, mine: 0, unassigned: 1, remindersDue: 0, reminders: 0, tags: [] },
  }));
  api.on("GET", `/conversations/${CONVERSATION_ID}/messages`, () => ({ json: { items: [], nextCursor: null } }));
  api.on("GET", `/inbox/conversations/${CONVERSATION_ID}/notes`, () => ({ json: { items: [] } }));
  api.on("GET", "/inbox/tags", () => ({ json: { items: [] } }));
}

async function open(page: Page) {
  await page.goto("/app/inbox");
  await page.getByText("Cliente Prueba").first().click();
  return page.getByTestId("ai-status");
}

test.describe("Estado de la IA en el chat", () => {
  test("auto sin pausa: verde 'IA activa'", async ({ page, api }) => {
    mockInbox(api, conversationFixture("auto"));
    const pill = await open(page);
    await expect(pill).toHaveAttribute("data-tone", "green");
    await expect(pill.getByText("IA activa: responde sola")).toBeVisible();
  });

  test("auto en pausa: ámbar con hora y botón Reanudar", async ({ page, api }) => {
    const until = new Date(Date.now() + 30 * 60_000).toISOString();
    mockInbox(api, { ...conversationFixture("auto"), automationsPausedUntil: until });
    const pill = await open(page);
    await expect(pill).toHaveAttribute("data-tone", "amber");
    await expect(pill.getByText(/IA en pausa hasta \d{2}:\d{2} \(respondiste tú\)/)).toBeVisible();
    await expect(pill.getByRole("button", { name: "Reanudar IA ahora" })).toBeVisible();
  });

  test("assist: azul", async ({ page, api }) => {
    mockInbox(api, conversationFixture("assist"));
    const pill = await open(page);
    await expect(pill).toHaveAttribute("data-tone", "blue");
    await expect(pill.getByText("IA asistente: redacta borradores, tú envías")).toBeVisible();
  });

  test("off: gris", async ({ page, api }) => {
    mockInbox(api, conversationFixture("off"));
    const pill = await open(page);
    await expect(pill).toHaveAttribute("data-tone", "gray");
    await expect(pill.getByText("IA apagada en este chat")).toBeVisible();
  });
});
