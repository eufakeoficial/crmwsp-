import type { Page } from "@playwright/test";
import { CHANNEL_ID, TENANT_ID, USER_ID, WEBHOOK_URL, channelFixture, expect, test, type ApiMock } from "./support";

/**
 * Journey of a brand-new client, with the API mocked at the network layer (no backend, no third party).
 * Every response mirrors the shape the web client parses with the shared zod contracts.
 */
const NOW = "2026-01-15T12:00:00.000Z";

const meResponse = (emailVerified = true) => ({
  user: { id: USER_ID, email: "owner@example.test", name: "Dueña E2E", emailVerified },
  tenants: [{ id: TENANT_ID, slug: "e2e", name: "Negocio E2E", role: "owner", status: "active" }],
});

const emptyUsage = { spentMinor: 0, currency: "EUR", budgetMinor: null, currencyMismatch: false, estimated: false, byKind: [] };
const capabilities = { structuredOutput: true, embeddings: true, transcription: false };
const agentConfig = { systemPrompt: "", aiModeDefault: "assist", confidenceThreshold: 0.7, approvalThresholdMinor: null };

function mockEmptyChannels(api: ApiMock) {
  api.on("GET", "/channels", () => ({ json: { items: [] } }));
  api.on("GET", "/channels/health", () => ({ json: { items: [] } }));
  api.on("GET", "/channels/360dialog/config", () => ({ json: { partnerId: null } }));
  api.on("GET", `/channels/${CHANNEL_ID}/balance`, () => ({ json: { status: "unavailable" } }));
}

test.describe("1. Registro", () => {
  const categories = [
    { key: "servicios", label: "Servicios profesionales", action: "allow", guidance: null },
    { key: "apuestas", label: "Apuestas", action: "block", guidance: null },
  ];

  test("valida los campos obligatorios y no llama a la API", async ({ page, api }) => {
    api.on("GET", "/business-categories", () => ({ json: { items: categories } }));
    await page.goto("/signup");
    await expect(page.getByRole("heading", { name: "Crear cuenta" })).toBeVisible();
    // The category catalog arrives asynchronously; the form must be complete before submitting.
    await expect(page.getByLabel("Rubro del negocio")).toBeVisible();

    await page.getByRole("button", { name: "Crear cuenta" }).click();

    await expect(page.getByText("Escribe tu nombre.")).toBeVisible();
    await expect(page.getByText("Escribe un correo válido.")).toBeVisible();
    await expect(page.getByText("La contraseña debe tener al menos 10 caracteres.")).toBeVisible();
    await expect(page.getByText("Escribe el nombre de tu empresa.")).toBeVisible();
    await expect(page.getByText("Elige el rubro de tu negocio.")).toBeVisible();
    expect(api.requests.some((r) => r.method === "POST" && r.path === "/auth/signup")).toBe(false);
  });

  test("un rubro bloqueado impide el registro", async ({ page, api }) => {
    api.on("GET", "/business-categories", () => ({ json: { items: categories } }));
    await page.goto("/signup");
    await expect(page.getByLabel("Rubro del negocio")).toBeVisible();
    await page.getByLabel("Tu nombre").fill("Ana");
    await page.getByLabel("Correo electrónico").fill("ana@example.test");
    await page.getByLabel("Contraseña", { exact: true }).fill("una-clave-larga-1");
    await page.getByLabel("Nombre de la empresa").fill("Mi Negocio");
    await page.getByLabel("Rubro del negocio").selectOption("apuestas");
    await page.getByRole("button", { name: "Crear cuenta" }).click();

    await expect(page.getByText("Este rubro no está permitido por las políticas de WhatsApp Business.").first()).toBeVisible();
    expect(api.requests.some((r) => r.method === "POST" && r.path === "/auth/signup")).toBe(false);
  });

  test("registro correcto: genera el identificador, envía el cuerpo y redirige al inbox", async ({ page, api }) => {
    api.on("GET", "/business-categories", () => ({ json: { items: categories } }));
    api.on("POST", "/auth/signup", () => ({ status: 201, json: meResponse(false) }));
    await page.goto("/signup");
    await expect(page.getByLabel("Rubro del negocio")).toBeVisible();

    await page.getByLabel("Tu nombre").fill("Ana");
    await page.getByLabel("Correo electrónico").fill("ana@example.test");
    await page.getByLabel("Contraseña", { exact: true }).fill("una-clave-larga-1");
    await page.getByLabel("Nombre de la empresa").fill("Mi Negocio");
    await expect(page.getByLabel("Identificador de la empresa")).toHaveValue("mi-negocio");
    await page.getByLabel("Rubro del negocio").selectOption("servicios");
    await page.getByRole("button", { name: "Crear cuenta" }).click();

    // First visit compiles the route in `next dev`, which can exceed the default timeout.
    await expect(page).toHaveURL(/\/app\/inbox$/, { timeout: 30_000 });
    const sent = api.requests.find((r) => r.method === "POST" && r.path === "/auth/signup");
    expect(sent?.body).toMatchObject({
      email: "ana@example.test",
      name: "Ana",
      tenantName: "Mi Negocio",
      tenantSlug: "mi-negocio",
      businessCategory: "servicios",
    });
  });

  test("correo ya registrado: muestra el mensaje de conflicto y no navega", async ({ page, api }) => {
    api.on("GET", "/business-categories", () => ({ json: { items: [] } }));
    api.on("POST", "/auth/signup", () => ({ status: 409, json: { code: "CONFLICT", message: "Conflict" } }));
    await page.goto("/signup");
    await page.getByLabel("Tu nombre").fill("Ana");
    await page.getByLabel("Correo electrónico").fill("ana@example.test");
    await page.getByLabel("Contraseña", { exact: true }).fill("una-clave-larga-1");
    await page.getByLabel("Nombre de la empresa").fill("Mi Negocio");
    await page.getByRole("button", { name: "Crear cuenta" }).click();

    await expect(page.getByText("No se pudo completar el registro. Prueba con otro correo u otro identificador de empresa.")).toBeVisible();
    await expect(page).toHaveURL(/\/signup$/);
  });
});

test.describe("2. Correo sin verificar", () => {
  test("la API responde 403 EMAIL_NOT_VERIFIED al conectar: la pantalla pide confirmar el correo", async ({ page, api }) => {
    mockEmptyChannels(api);
    api.on("POST", "/channels/gupshup", () => ({ status: 403, json: { code: "EMAIL_NOT_VERIFIED", message: "Email not verified" } }));
    await page.goto("/app/channels");

    await page.getByLabel("Teléfono (formato internacional)").fill("+5491155551234");
    await page.getByLabel("Nombre de la app en Gupshup").fill("MiEmpresaApp");
    await page.getByLabel("API key de Gupshup").fill("sk_test_SECRET_9876543210");
    await page.getByRole("button", { name: "Conectar canal" }).click();

    await expect(page.getByText("Confirma tu correo para conectar WhatsApp").first()).toBeVisible();
    await expect(page.getByTestId("channel-card")).toHaveCount(0);
  });

  test("con el correo sin verificar el dueño ve el aviso, puede reenviar y no puede abrir la guía", async ({ page, api }) => {
    api.on("GET", "/auth/me", () => ({ json: meResponse(false) }));
    mockEmptyChannels(api);
    api.on("POST", "/auth/resend-verification", () => ({ json: {} }));
    await page.goto("/app/channels");

    await expect(page.getByText("Confirma tu correo para conectar WhatsApp")).toBeVisible();
    await expect(page.getByRole("button", { name: "Conectar WhatsApp (Gupshup)" })).toBeDisabled();
    await expect(page.getByRole("heading", { name: "Conectar WhatsApp (Gupshup)" })).toHaveCount(0);

    await page.getByRole("button", { name: "Reenviar correo" }).click();
    await expect(page.getByText("Te enviamos un correo a owner@example.test.")).toBeVisible();
  });
});

test.describe("3. Primeros pasos", () => {
  function mockProgress(api: ApiMock, channels: unknown[] = [channelFixture()]) {
    api.on("GET", "/products", () => ({ json: { items: [], nextCursor: null } }));
    api.on("GET", "/knowledge/sources", () => ({
      json: { items: [{ id: "src-1", kind: "faq", title: "Preguntas", status: "ready", version: 1, chunkCount: 3, updatedAt: NOW }] },
    }));
    api.on("GET", "/ai/connection", () => ({ json: null }));
    api.on("GET", "/channels", () => ({ json: { items: channels } }));
    api.on("GET", "/ai/agent-config", () => ({ json: agentConfig }));
    api.on("GET", "/tenant/members", () => ({ json: { items: [] } }));
  }
  const cardOf = (page: Page) => page.getByLabel("Primeros pasos", { exact: true }).filter({ hasText: "completados" });

  test("muestra 2 de 4 completados y cada paso pendiente enlaza a su página", async ({ page, api }) => {
    mockProgress(api);
    await page.goto("/app");

    const card = cardOf(page);
    await expect(card.getByText("2 de 4 completados")).toBeVisible();
    await expect(card.getByRole("progressbar", { name: "Progreso de configuración" })).toHaveAttribute("aria-valuenow", "50");
    // Completed steps have no call to action.
    await expect(card.getByRole("link", { name: "Conectar", exact: true })).toHaveCount(0);
    await expect(card.getByRole("link", { name: "Configurar", exact: true })).toHaveAttribute("href", "/app/ai");
    await expect(card.getByRole("link", { name: "Probar", exact: true })).toHaveAttribute("href", "/app/settings/ai/simulator");
    await expect(card.getByRole("link", { name: "Invitar", exact: true })).toHaveAttribute("href", "/app/team");
    await expect(card.getByRole("link", { name: "Prefiero un asistente paso a paso" })).toHaveAttribute("href", "/app/onboarding");

    await card.getByRole("link", { name: "Probar", exact: true }).click();
    await expect(page).toHaveURL(/\/app\/settings\/ai\/simulator$/, { timeout: 30_000 });
  });

  test("«Ya lo hice» marca el simulador y el contador sube a 3 de 4", async ({ page, api }) => {
    mockProgress(api);
    await page.goto("/app");
    const card = cardOf(page);
    await expect(card.getByText("2 de 4 completados")).toBeVisible();

    await card.getByRole("button", { name: "Ya lo hice" }).first().click();

    await expect(card.getByText("3 de 4 completados")).toBeVisible();
  });

  test("sin canal, el primer paso lleva a Canales", async ({ page, api }) => {
    mockProgress(api, []);
    await page.goto("/app");
    await expect(cardOf(page).getByRole("link", { name: "Conectar", exact: true })).toHaveAttribute("href", "/app/channels");
  });
});

test.describe("4. Conectar Gupshup y paso del webhook", () => {
  test("tras conectar muestra la URL copiable del webhook y la nota de privacidad", async ({ page, api, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    mockEmptyChannels(api);
    api.on("POST", "/channels/gupshup", () => ({ status: 201, json: channelFixture() }));
    await page.goto("/app/channels");

    await page.getByLabel("Teléfono (formato internacional)").fill("+5491155551234");
    await page.getByLabel("Nombre de la app en Gupshup").fill("MiEmpresaApp");
    await page.getByLabel("API key de Gupshup").fill("sk_test_SECRET_9876543210");
    await page.getByRole("button", { name: "Conectar canal" }).click();

    const panel = page.getByTestId("connect-channel-panel");
    await expect(panel.getByText("Pega la URL de webhook en Gupshup")).toBeVisible();
    await expect(panel.getByTestId("webhook-url")).toHaveText(WEBHOOK_URL);
    await expect(panel.getByText("Esta URL es privada: no la compartas.")).toBeVisible();

    await panel.getByRole("button", { name: "Copiar" }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(WEBHOOK_URL);
  });
});

test.describe("5. Proveedor de IA", () => {
  function mockAi(api: ApiMock) {
    let saved: unknown = null;
    api.on("GET", "/ai/connection", () => ({ json: saved }));
    api.on("GET", "/ai/usage", () => ({ json: emptyUsage }));
    api.on("GET", "/ai/agent-config", () => ({ json: agentConfig }));
    api.on("PUT", "/ai/connection", (req) => {
      const b = req.body as { provider: string; baseUrl: string; modelCheap: string; modelStrong: string };
      saved = {
        provider: b.provider,
        baseUrl: b.baseUrl,
        apiKeyHint: "••••1234",
        modelCheap: b.modelCheap,
        modelStrong: b.modelStrong,
        capabilities,
        lastTestedAt: null,
        lastTestOk: null,
        monthlyBudgetMinor: null,
        budgetCurrency: null,
      };
      return { json: saved };
    });
  }

  test("elegir OpenRouter muestra su guía y su enlace de claves", async ({ page, api }) => {
    mockAi(api);
    await page.goto("/app/settings/ai");
    await expect(page.getByRole("heading", { name: "Consigue tu API key de OpenAI" })).toBeVisible();

    await page.getByRole("radio", { name: /OpenRouter/ }).click();

    await expect(page.getByRole("heading", { name: "Consigue tu API key de OpenRouter" })).toBeVisible();
    await expect(page.getByText("Entra en openrouter.ai y crea tu cuenta.")).toBeVisible();
    await expect(page.getByRole("link", { name: /Abrir openrouter\.ai\/keys/ })).toHaveAttribute("href", "https://openrouter.ai/keys");
    await expect(page.getByLabel("Modelo barato (respuestas habituales)")).toHaveValue("openai/gpt-4o-mini");
  });

  test("guardar sin API key avisa y no llama a la API", async ({ page, api }) => {
    mockAi(api);
    await page.goto("/app/settings/ai");
    await page.getByRole("radio", { name: /OpenRouter/ }).click();
    await page.getByRole("button", { name: "Guardar conexión" }).click();

    await expect(page.getByText("Pega tu API key para conectar.")).toBeVisible();
    expect(api.requests.some((r) => r.method === "PUT" && r.path === "/ai/connection")).toBe(false);
  });

  test("guardar envía proveedor, URL base y modelos, y deja solo la clave enmascarada", async ({ page, api }) => {
    mockAi(api);
    await page.goto("/app/settings/ai");
    await page.getByRole("radio", { name: /OpenRouter/ }).click();
    await page.getByLabel("API key", { exact: true }).fill("sk-or-v1-0123456789abcdef");
    await page.getByRole("button", { name: "Guardar conexión" }).click();

    await expect(page.getByText("Configuración de IA guardada")).toBeVisible();
    const sent = api.requests.find((r) => r.method === "PUT" && r.path === "/ai/connection");
    expect(sent?.body).toMatchObject({
      provider: "openrouter",
      baseUrl: "https://openrouter.ai/api/v1",
      apiKey: "sk-or-v1-0123456789abcdef",
      modelCheap: "openai/gpt-4o-mini",
    });
    await expect(page.getByLabel("API key", { exact: true })).toHaveValue("");
    await expect(page.getByLabel("API key", { exact: true })).toHaveAttribute("placeholder", /••••1234/);
  });

  test("error de validación de la API al guardar: se muestra y no hay confirmación", async ({ page, api }) => {
    mockAi(api);
    api.on("PUT", "/ai/connection", () => ({ status: 400, json: { code: "VALIDATION_ERROR", message: "Bad request" } }));
    await page.goto("/app/settings/ai");
    await page.getByLabel("API key", { exact: true }).fill("sk-0123456789abcdef");
    await page.getByRole("button", { name: "Guardar conexión" }).click();

    await expect(page.getByText("Revisa los datos introducidos.")).toBeVisible();
    await expect(page.getByText("Configuración de IA guardada")).toHaveCount(0);
  });
});

test.describe("6. Conocimiento", () => {
  test("añadir un texto pegado lo lista con el estado «Lista»", async ({ page, api }) => {
    const sources: unknown[] = [];
    api.on("GET", "/knowledge/sources", () => ({ json: { items: sources } }));
    api.on("GET", "/knowledge/conflicts", () => ({ json: { items: [] } }));
    api.on("POST", "/knowledge/sources", (req) => {
      const b = req.body as { kind: string; title: string };
      const created = { id: "src-1", kind: b.kind, title: b.title, status: "ready", version: 1, chunkCount: 2, updatedAt: NOW };
      sources.push(created);
      return { status: 201, json: created };
    });
    await page.goto("/app/settings/knowledge");
    await expect(page.getByText("Aún no hay fuentes")).toBeVisible();

    await page.getByRole("button", { name: /FAQ o texto pegado/ }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Tipo").selectOption("text");
    await dialog.getByLabel("Título").fill("Horarios y precios");
    await dialog.getByLabel("Contenido").fill("Abrimos de lunes a viernes. El corte cuesta 15 EUR.");
    await dialog.getByRole("button", { name: "Añadir" }).click();

    const list = page.getByRole("region", { name: "Fuentes de conocimiento" });
    await expect(list.getByText("Horarios y precios")).toBeVisible();
    await expect(list.getByText("Lista", { exact: true })).toBeVisible();
    const sent = api.requests.find((r) => r.method === "POST" && r.path === "/knowledge/sources");
    expect(sent?.body).toEqual({ kind: "text", title: "Horarios y precios", content: "Abrimos de lunes a viernes. El corte cuesta 15 EUR." });
  });

  test("título o contenido vacíos: avisa y no llama a la API", async ({ page, api }) => {
    api.on("GET", "/knowledge/sources", () => ({ json: { items: [] } }));
    api.on("GET", "/knowledge/conflicts", () => ({ json: { items: [] } }));
    await page.goto("/app/settings/knowledge");
    await page.getByRole("button", { name: /FAQ o texto pegado/ }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Añadir" }).click();

    await expect(page.getByText("Indica un título y pega el contenido.")).toBeVisible();
    expect(api.requests.some((r) => r.method === "POST" && r.path === "/knowledge/sources")).toBe(false);
  });
});

test.describe("7. Simulador de IA", () => {
  test("envía un mensaje de cliente y muestra la respuesta de la IA", async ({ page, api }) => {
    api.on("GET", "/ai/scenarios", () => ({ json: { items: [] } }));
    api.on("POST", "/ai/simulate", () => ({
      json: {
        promptSource: "active",
        model: "gpt-4o-mini",
        reply: { text: "El corte cuesta 15 EUR.", outcome: "send", reason: "Respuesta con cita", claims: [] },
        actions: [],
        handoff: false,
        confidence: 0.9,
        confidenceThreshold: 0.7,
        needsHuman: false,
        modelReason: "ok",
        retrievedChunks: 2,
        usage: { inputTokens: 100, outputTokens: 20, embeddingTokens: 5, costUsd: 0.0001, priceKnown: true },
      },
    }));
    await page.goto("/app/settings/ai/simulator");

    await page.getByLabel("Mensaje del cliente").fill("Hola, ¿cuánto cuesta un corte?");
    await page.getByRole("button", { name: "Enviar" }).click();

    await expect(page.getByRole("listitem").filter({ hasText: "Hola, ¿cuánto cuesta un corte?" })).toBeVisible();
    await expect(page.getByRole("listitem").filter({ hasText: "El corte cuesta 15 EUR." })).toBeVisible();
    await expect(page.getByText("Respuesta · Se enviaría")).toBeVisible();
    const sent = api.requests.find((r) => r.method === "POST" && r.path === "/ai/simulate");
    expect(sent?.body).toEqual({ messages: [{ author: "contact", text: "Hola, ¿cuánto cuesta un corte?" }] });
  });
});

test.describe("8. Perfil de WhatsApp", () => {
  test("canal sin credenciales de Partner: guía para conseguir ID de app y Token de Partner", async ({ page, api }) => {
    api.on("GET", "/channels", () => ({ json: { items: [channelFixture({ partnerConfigured: false })] } }));
    await page.goto("/app/settings/whatsapp-profile");

    await expect(page.getByText("Falta conectar el perfil de +5491155551234")).toBeVisible();
    await expect(page.getByText(/necesitamos el ID de app y el Token de Partner/)).toBeVisible();
    await expect(page.getByRole("link", { name: "Ir a Canales" })).toHaveAttribute("href", "/app/channels");
  });

  test("la API responde VALIDATION_ERROR por falta de Token de Partner: se muestra la misma guía", async ({ page, api }) => {
    api.on("GET", "/channels", () => ({ json: { items: [channelFixture({ partnerConfigured: true })] } }));
    api.on("GET", `/whatsapp-profile/${CHANNEL_ID}`, () => ({
      status: 400,
      json: { code: "VALIDATION_ERROR", message: "Este canal no tiene ID de app ni Token de Partner de Gupshup. Agrégalos en Canales." },
    }));
    await page.goto("/app/settings/whatsapp-profile");

    await expect(page.getByText(/Falta conectar el perfil/)).toBeVisible();
    await expect(page.getByText(/necesitamos el ID de app y el Token de Partner/)).toBeVisible();
    await expect(page.getByRole("link", { name: "portal de Gupshup Partner" })).toBeVisible();
  });
});

test.describe("9. Modo dueño", () => {
  const status = { phone: null, aiPaused: false };
  const pendingStatus = (phoneE164: string) => ({
    phone: {
      id: "77777777-7777-4777-8777-777777777777",
      userId: USER_ID,
      phoneE164,
      status: "pending",
      verifiedAt: null,
      codeExpiresAt: "2099-01-01T00:00:00.000Z",
      attemptsLeft: 5,
    },
    aiPaused: false,
  });

  test("acepta un teléfono con espacios, lo envía tal cual y pide el código", async ({ page, api }) => {
    api.on("GET", "/owner-mode", () => ({ json: status }));
    api.on("POST", "/owner-mode/phone", () => ({ json: pendingStatus("+51906109195") }));
    await page.goto("/app/settings/owner-mode");

    await page.getByLabel("Número en formato internacional").fill("+51 906 109 195");
    await page.getByRole("button", { name: "Enviar código" }).click();

    await expect(page.getByLabel("Código de 6 dígitos recibido por WhatsApp")).toBeVisible();
    await expect(page.getByText("Escribe el número con el código de país")).toHaveCount(0);
    const sent = api.requests.find((r) => r.method === "POST" && r.path === "/owner-mode/phone");
    expect(sent?.body).toEqual({ phoneE164: "+51 906 109 195" });
  });

  const failures: Array<[string, number, string, string]> = [
    ["número del negocio", 400, "Phone is the business channel number", "Ese es el número del negocio. Usa tu número personal."],
    ["sin canal activo", 400, "No active WhatsApp channel", "Primero activa tu canal de WhatsApp en Configuración → WhatsApp."],
    ["formato inválido", 400, "Invalid E.164 phone number", "Escribe el número con el código de país, por ejemplo +51906109195."],
    ["vinculado a otro miembro", 409, "Phone already linked", "Ese número ya está vinculado a otro miembro del equipo."],
  ];
  for (const [name, httpStatus, apiMessage, uiText] of failures) {
    test(`error ${httpStatus} (${name}): muestra el texto específico`, async ({ page, api }) => {
      api.on("GET", "/owner-mode", () => ({ json: status }));
      api.on("POST", "/owner-mode/phone", () => ({
        status: httpStatus,
        json: { code: httpStatus === 409 ? "CONFLICT" : "VALIDATION_ERROR", message: apiMessage },
      }));
      await page.goto("/app/settings/owner-mode");

      await page.getByLabel("Número en formato internacional").fill("+51 906 109 195");
      await page.getByRole("button", { name: "Enviar código" }).click();

      await expect(page.getByText(uiText)).toBeVisible();
    });
  }
});
