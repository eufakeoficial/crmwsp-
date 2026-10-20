import type { AiApi, KnowledgeApi } from "./ai-api";
import type { AgentConfig, AiAction, AiConnection, KnowledgeConflict, KnowledgeSource } from "./ai-schemas";

// In-memory stand-in for the F2-E API. Only wired when NEXT_PUBLIC_AI_API_MOCK=1 outside production.

const delay = <T>(value: T, ms = 250): Promise<T> => new Promise((r) => setTimeout(() => r(value), ms));
const now = () => new Date().toISOString();

let connection: AiConnection | null = null;
let storedKeyHint: string | null = null;
let agent: AgentConfig = {
  systemPrompt: "Eres el asistente de una empresa de servicios. Responde con amabilidad y brevedad.",
  aiModeDefault: "assist",
  confidenceThreshold: 0.7,
  approvalThresholdMinor: 50_000,
};

let sources: KnowledgeSource[] = [
  { id: "src-1", kind: "csv", title: "Lista de precios 2026.csv", status: "ready", version: 2, chunkCount: 48, updatedAt: now() },
  { id: "src-2", kind: "pdf", title: "Condiciones de servicio.pdf", status: "error", version: 1, chunkCount: 0, updatedAt: now(), error: "El PDF está protegido con contraseña." },
];
const conflicts: KnowledgeConflict[] = [
  {
    key: "Instalación split 3000 frigorías",
    sources: [
      { sourceId: "src-1", title: "Lista de precios 2026.csv", priceMinor: 18_000, currency: "EUR" },
      { sourceId: "src-3", title: "Tarifa antigua.csv", priceMinor: 16_500, currency: "EUR" },
    ],
  },
];

let actions: AiAction[] = [
  {
    id: "act-1", type: "apply_discount", status: "pending_approval", conversationId: "conv-1", contactName: "María López",
    payload: { descuento: "15 %", presupuesto: "Q-0042", importe: "1.280,00 EUR" },
    reason: "El descuento supera el umbral que no requiere aprobación.",
    citations: [{ chunkId: "ch-1", title: "Política de descuentos", excerpt: "Descuento máximo del 10 % sin aprobación." }],
    createdAt: now(),
  },
  {
    id: "act-2", type: "create_quote", status: "pending_approval", conversationId: "conv-2", contactName: "Carlos Ruiz",
    payload: { servicio: "Instalación split", importe: "820,00 EUR", plazo: "5 días" },
    reason: "Importe por encima del umbral de aprobación de presupuestos.",
    citations: [{ chunkId: "ch-2", title: "Lista de precios 2026.csv", excerpt: "Instalación split 3000 frigorías: 180,00 EUR" }],
    createdAt: now(),
  },
  {
    id: "act-3", type: "send_template", status: "pending_approval", conversationId: "conv-3", contactName: "Lucía Gómez",
    payload: { plantilla: "recordatorio_visita", idioma: "es" },
    reason: "Fuera de la ventana de 24 h: requiere plantilla aprobada.",
    citations: [],
    createdAt: now(),
  },
];

function testCaps(provider: AiConnection["provider"]) {
  return { structuredOutput: true, embeddings: provider !== "deepseek", transcription: provider === "openai" };
}

export const mockAiApi: AiApi = {
  getConnection: () => delay(connection),
  saveConnection: (input) => {
    if (input.apiKey) storedKeyHint = `••••${input.apiKey.slice(-4)}`;
    connection = {
      provider: input.provider,
      baseUrl: input.baseUrl ?? "",
      apiKeyHint: storedKeyHint,
      modelCheap: input.modelCheap,
      modelStrong: input.modelStrong,
      capabilities: connection?.capabilities ?? testCaps(input.provider),
      lastTestedAt: connection?.lastTestedAt ?? null,
      lastTestOk: connection?.lastTestOk ?? null,
      monthlyBudgetMinor: input.monthlyBudgetMinor ?? null,
      budgetCurrency: input.budgetCurrency ?? null,
    };
    return delay(connection);
  },
  testConnection: () => {
    if (!connection) return Promise.reject(new Error("No connection"));
    connection = { ...connection, capabilities: testCaps(connection.provider), lastTestedAt: now(), lastTestOk: true };
    return delay({ ok: true, capabilities: connection.capabilities, latencyMs: 420 }, 700);
  },
  deleteConnection: () => {
    connection = null;
    storedKeyHint = null;
    return delay(undefined);
  },
  usage: () => delay({ spentMinor: 8_400, currency: connection?.budgetCurrency ?? "EUR", budgetMinor: connection?.monthlyBudgetMinor ?? null, byKind: [{ kind: "reply", costMinor: 6_100 }, { kind: "embedding", costMinor: 1_500 }, { kind: "transcription", costMinor: 800 }] }),
  getAgentConfig: () => delay(agent),
  saveAgentConfig: (input) => {
    agent = input;
    return delay(agent);
  },
  listActions: () => delay(actions.filter((a) => a.status === "pending_approval")),
  approveAction: (id) => {
    actions = actions.map((a) => (a.id === id ? { ...a, status: "approved" } : a));
    return delay(undefined);
  },
  rejectAction: (id) => {
    actions = actions.map((a) => (a.id === id ? { ...a, status: "rejected" } : a));
    return delay(undefined);
  },
};

export const mockKnowledgeApi: KnowledgeApi = {
  listSources: () => delay([...sources]),
  createSource: (input) => {
    const title = "file" in input ? input.file.name : input.title;
    const created: KnowledgeSource = { id: `src-${Date.now()}`, kind: input.kind, title, status: "ready", version: 1, chunkCount: 12, updatedAt: now() };
    sources = [created, ...sources];
    return delay(created, 600);
  },
  deleteSource: (id) => {
    sources = sources.filter((s) => s.id !== id);
    return delay(undefined);
  },
  conflicts: () => delay([...conflicts]),
};
