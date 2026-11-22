import { CONVERSATION_ID, conversationFixture, expect, test } from "./support";

test("el selector de modo de IA del inbox hace PATCH con aiMode auto", async ({ page, api }) => {
  let current = conversationFixture("assist");
  api.on("GET", "/inbox/conversations", () => ({ json: { items: [current], nextCursor: null } }));
  api.on("GET", `/inbox/conversations/${CONVERSATION_ID}`, () => ({ json: current }));
  api.on("GET", "/inbox/counts", () => ({
    json: { open: 1, closed: 0, unread: 0, mine: 0, unassigned: 1, remindersDue: 0, reminders: 0, tags: [] },
  }));
  api.on("GET", `/conversations/${CONVERSATION_ID}/messages`, () => ({ json: { items: [], nextCursor: null } }));
  api.on("GET", `/inbox/conversations/${CONVERSATION_ID}/notes`, () => ({ json: { items: [] } }));
  api.on("GET", "/inbox/tags", () => ({ json: { items: [] } }));
  api.on("PATCH", `/conversations/${CONVERSATION_ID}`, (req) => {
    current = { ...current, aiMode: (req.body as { aiMode: "auto" }).aiMode, lockVersion: current.lockVersion + 1 };
    return { json: current };
  });

  await page.goto("/app/inbox");
  await page.getByText("Cliente Prueba").first().click();
  const selector = page.getByRole("combobox", { name: "Modo de IA de esta conversación" });
  await expect(selector).toBeVisible();

  await selector.selectOption("auto");

  await expect
    .poll(() => api.requests.find((r) => r.method === "PATCH" && r.path === `/conversations/${CONVERSATION_ID}`)?.body)
    .toMatchObject({ aiMode: "auto", lockVersion: 1 });
  await expect(selector).toHaveValue("auto");
});
