import { type ApiMock, CONVERSATION_ID, CONTACT_ID, USER_ID, conversationFixture, expect, test } from "./support";

const CONVERSATION_B = "99999999-9999-4999-8999-999999999999";
const CONTACT_B = "55555555-5555-4555-8555-555555555556";
const QUOTE_A = "77777777-7777-4777-8777-777777777777";
const QUOTE_B = "88888888-8888-4888-8888-888888888888";
const DAY = 86_400_000;

function quoteFixture(quoteId: string, patch: Record<string, unknown> = {}) {
  return {
    quoteId,
    number: "PRE-2026-0001",
    conversationId: CONVERSATION_ID,
    contactId: CONTACT_ID,
    contactName: "Cliente Prueba",
    contactPhone: "+5491166667777",
    totalMinor: 125000,
    currency: "PEN",
    sentAt: new Date(Date.now() - 2 * DAY).toISOString(),
    eligibleAt: new Date(Date.now()).toISOString(),
    validUntil: new Date(Date.now() + 30 * DAY).toISOString(),
    assignee: null,
    reminderAt: null,
    ...patch,
  };
}

function baseRows() {
  return [
    quoteFixture(QUOTE_A),
    quoteFixture(QUOTE_B, {
      number: "PRE-2026-0002",
      conversationId: CONVERSATION_B,
      contactId: CONTACT_B,
      contactName: "Rosa López",
      assignee: { id: USER_ID, name: "Dueña E2E" },
      reminderAt: "2026-01-16T09:00:00.000Z",
    }),
  ];
}

function manyRows(count: number) {
  return Array.from({ length: count }, (_, i) =>
    quoteFixture(`${String(i + 1).padStart(8, "0")}-7777-4777-8777-777777777777`, { number: `PRE-2026-${String(i + 1).padStart(4, "0")}` }),
  );
}

function mockInbox(api: ApiMock, initial: unknown[]) {
  const state = { rows: initial, fail: false };
  api.on("GET", "/quotes/unanswered", () =>
    state.fail ? { status: 500, json: {} } : { json: { items: state.rows, nextCursor: null, counts: { eligible: state.rows.length, unknownCoverage: 1 } } },
  );
  api.on("POST", `/quotes/unanswered/${QUOTE_B}/review`, () => {
    state.rows = state.rows.filter((r) => (r as { quoteId: string }).quoteId !== QUOTE_B);
    return { json: { quoteId: QUOTE_B, messageId: "66666666-6666-4666-8666-666666666666", reviewedBy: USER_ID, reviewedAt: new Date().toISOString() } };
  });
  api.on("GET", "/inbox/counts", () => ({
    json: { open: 1, closed: 0, unread: 0, mine: 0, unassigned: 1, remindersDue: 0, reminders: 0, tags: [], unanswered: state.rows.length },
  }));
  api.on("GET", `/inbox/conversations/${CONVERSATION_ID}`, () => ({ json: conversationFixture() }));
  api.on("GET", `/conversations/${CONVERSATION_ID}/messages`, () => ({ json: { items: [], nextCursor: null } }));
  api.on("GET", `/inbox/conversations/${CONVERSATION_ID}/notes`, () => ({ json: { items: [] } }));
  api.on("GET", "/inbox/tags", () => ({ json: { items: [] } }));
  return state;
}

const reviews = (api: ApiMock) => api.requests.filter((r) => r.method === "POST" && r.path.endsWith("/review"));
const conversationListCalls = (api: ApiMock) => api.requests.filter((r) => r.method === "GET" && r.path === "/inbox/conversations").length;

test("la carpeta de presupuestos sin respuesta lista, abre el chat exacto y marca como revisada", async ({ page, api }) => {
  mockInbox(api, baseRows());
  await page.goto("/app/inbox");
  const folder = page.getByRole("button", { name: /Presupuestos sin respuesta/ });
  await expect(folder).toContainText("2");
  await folder.click();
  const listCalls = conversationListCalls(api);

  await expect(page.getByText("Enviados y todavía sin respuesta del cliente.")).toBeVisible();
  const rows = page.getByTestId("unanswered-quote");
  await expect(rows).toHaveCount(2);
  await expect(page.getByText("Hay 1 presupuesto enviado cuyo envío no se puede confirmar.")).toBeVisible();
  await expect(page.getByRole("toolbar", { name: "Filtros de conversaciones" })).toHaveCount(0);
  await expect(rows.nth(0)).toContainText("Cliente Prueba");
  await expect(rows.nth(0)).toContainText("PRE-2026-0001");
  await expect(rows.nth(0)).toContainText("S/ 1,250.00");
  await expect(rows.nth(0)).toContainText("Enviado hace 2 d");
  await expect(rows.nth(0)).toContainText("Sin asignar");
  await expect(rows.nth(1)).toContainText("Responsable: Dueña E2E");
  await expect(rows.nth(1)).toContainText("Recordatorio:");
  const reviewA = rows.nth(0).getByRole("button", { name: /como revisada/ });
  await expect(reviewA.getByText("Marcar como revisada", { exact: true })).toBeVisible();
  await expect(reviewA.getByText("Revisar", { exact: true })).toBeHidden();

  await rows.nth(0).locator("button").first().click();
  await expect(rows.nth(0).locator("button").first()).toHaveAttribute("aria-current", "true");
  await expect.poll(() => api.requests.some((r) => r.path === `/inbox/conversations/${CONVERSATION_ID}`)).toBe(true);
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toBeVisible();
  expect(reviews(api)).toHaveLength(0);

  await page.getByRole("button", { name: "Marcar PRE-2026-0002 como revisada" }).click();
  await expect(page.getByText("Presupuesto marcado como revisado")).toBeVisible();
  await expect(rows).toHaveCount(1);
  await expect(rows.nth(0)).toContainText("PRE-2026-0001");
  await expect(folder).toContainText("1");
  expect(reviews(api)).toHaveLength(1);
  expect(conversationListCalls(api)).toBe(listCalls);
});

test("el lector ve la lista sin la acción de revisar", async ({ page, api }) => {
  mockInbox(api, baseRows());
  api.on("GET", "/auth/me", () => ({
    json: {
      user: { id: USER_ID, email: "lector@example.test", name: "Lector E2E", emailVerified: true },
      tenants: [{ id: "11111111-1111-4111-8111-111111111111", slug: "e2e", name: "Negocio E2E", role: "viewer", status: "active" }],
    },
  }));
  await page.goto("/app/inbox");
  await page.getByRole("button", { name: /Presupuestos sin respuesta/ }).click();

  const rows = page.getByTestId("unanswered-quote");
  await expect(rows).toHaveCount(2);
  await expect(page.getByRole("button", { name: /como revisada/ })).toHaveCount(0);
});

test("un fallo de carga muestra el error y permite reintentar", async ({ page, api }) => {
  const state = mockInbox(api, baseRows());
  state.fail = true;
  await page.goto("/app/inbox");
  await page.getByRole("button", { name: /Presupuestos sin respuesta/ }).click();

  await expect(page.getByText("Ocurrió un error en el servidor. Inténtalo más tarde.")).toBeVisible();
  const retry = page.getByRole("button", { name: "Reintentar" });
  await expect(retry).toBeVisible();
  state.fail = false;
  await retry.click();

  await expect(page.getByTestId("unanswered-quote")).toHaveCount(2);
  await expect(retry).toHaveCount(0);
});

test.describe("teléfono", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("la carpeta se elige arriba, abre el chat y vuelve a la misma posición", async ({ page, api }) => {
    mockInbox(api, manyRows(40));
    await page.goto("/app/inbox");
    const picker = page.getByRole("combobox", { name: "Carpeta" });
    await picker.selectOption("unanswered");

    const list = page.getByTestId("unanswered-quote-list");
    const rows = page.getByTestId("unanswered-quote");
    await expect(rows).toHaveCount(40);
    const review = rows.nth(0).getByRole("button", { name: /como revisada/ });
    await expect(review.getByText("Revisar", { exact: true })).toBeVisible();
    await expect(review.getByText("Marcar como revisada", { exact: true })).toBeHidden();
    await expect(page.getByRole("button", { name: "Volver a la lista" })).toHaveCount(0);

    await list.evaluate((el) => {
      el.scrollTop = 1200;
    });
    const before = await list.evaluate((el) => el.scrollTop);
    expect(before).toBeGreaterThan(0);

    await rows.nth(30).locator("button").first().evaluate((el: HTMLElement) => el.click());
    const back = page.getByRole("button", { name: "Volver a la lista" });
    await expect(back).toBeVisible();
    await expect(list).toBeHidden();
    expect(reviews(api)).toHaveLength(0);

    await back.click();
    await expect(list).toBeVisible();
    await expect(picker).toHaveValue("unanswered");
    await expect(rows).toHaveCount(40);
    await expect.poll(() => list.evaluate((el) => el.scrollTop)).toBe(before);
  });
});
