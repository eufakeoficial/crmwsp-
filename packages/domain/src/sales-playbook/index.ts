import {
  playbookConfigSchema,
  SALES_STAGES,
  type PlaybookConfig,
  type PlaybookPromptContext,
  type SalesStage,
} from "@crmwsp/contracts";

/*
 * Sales playbook rules (pure). The playbook is guidance for tone and ordering only:
 * it never relaxes the AI hard rules (cited prices/stock/lead times, no deception, no fake
 * scarcity, never claiming to be human). Those rules live in the prompt builder.
 */

/** Hard caps applied when a playbook is turned into prompt text (keeps the block token-budgeted). */
export const PLAYBOOK_PROMPT_CAPS = { stage: 250, trigger: 100, response: 300, objections: 2 } as const;

export const DEFAULT_PLAYBOOK: PlaybookConfig = {
  enabled: false,
  stages: {
    discovery:
      "Haz una pregunta a la vez para entender qué necesita, para qué lo quiere y para cuándo. Escucha antes de ofrecer.",
    proposal:
      "Recomienda la opción que mejor encaja con lo que dijo el cliente y explica por qué, con datos de la base de conocimiento. Ofrece como máximo dos alternativas.",
    objections:
      "Reconoce la duda con empatía, pregunta qué la causa y responde con información verificable. No presiones ni discutas.",
    closing:
      "Resume lo acordado y propone un único siguiente paso claro (presupuesto, pedido o pago). Pregunta si quiere continuar.",
    followup:
      "Retoma la conversación con algo útil, sin reproches y sin repetir lo ya dicho. Respeta que el cliente decida no continuar.",
  },
  objections: [
    {
      id: "es-caro",
      trigger: "Dice que es caro, que el precio es alto o pide descuento",
      response:
        "Reconoce la preocupación, explica el valor con datos citados de la base de conocimiento y, si existe, ofrece una alternativa más económica o un descuento autorizado. Nunca inventes descuentos.",
    },
    {
      id: "lo-voy-a-pensar",
      trigger: "Dice que lo va a pensar, que luego avisa o que lo consultará",
      response:
        "Respeta su tiempo, pregunta con amabilidad si hay algo concreto que le genere duda y ofrece enviarle un resumen. No crees urgencia falsa.",
    },
    {
      id: "envios-plazos",
      trigger: "Pregunta por envíos, entregas, plazos o tiempos de entrega",
      response:
        "Responde solo con los plazos y condiciones que consten en la base de conocimiento, citándolos. Si no constan, deriva a una persona.",
    },
    {
      id: "no-confio",
      trigger: "Dice que no confía, que desconfía o pregunta si es seguro y si es una estafa",
      response:
        "Responde con calma y transparencia: explica cómo funciona la compra y el pago con información verificable. Ofrece hablar con una persona del equipo.",
    },
  ],
  closingStyle: "soft",
  followUp: { enabled: false, delayHours: 4, maxFollowUps: 2 },
};

/** Reads a stored playbook row; anything missing or invalid falls back to the defaults. */
export function resolvePlaybook(row: { enabled: boolean; config: unknown } | null | undefined): PlaybookConfig {
  if (!row) return DEFAULT_PLAYBOOK;
  const raw = isObj(row.config) ? row.config : {};
  const merged = {
    ...DEFAULT_PLAYBOOK,
    ...raw,
    stages: { ...DEFAULT_PLAYBOOK.stages, ...(isObj(raw["stages"]) ? raw["stages"] : {}) },
    followUp: { ...DEFAULT_PLAYBOOK.followUp, ...(isObj(raw["followUp"]) ? raw["followUp"] : {}) },
    enabled: row.enabled,
  };
  const parsed = playbookConfigSchema.safeParse(merged);
  return parsed.success ? parsed.data : { ...DEFAULT_PLAYBOOK, enabled: false };
}

/** The part of the config stored in `sales_playbooks.config` (the flag lives in its own column). */
export function playbookConfigColumn(cfg: PlaybookConfig): Record<string, unknown> {
  const { stages, objections, closingStyle, followUp } = cfg;
  return { stages, objections, closingStyle, followUp };
}

export function isSalesStage(v: unknown): v is SalesStage {
  return typeof v === "string" && (SALES_STAGES as readonly string[]).includes(v);
}

const STOPWORDS = new Set([
  "dice", "que", "para", "como", "esta", "este", "tiene", "tienen", "cliente", "pregunta", "sobre", "cuando", "donde", "pide",
  "quiere", "algo", "pero", "porque", "sino", "son", "una", "unos", "unas", "con", "los", "las", "del",
]);

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 4 && !STOPWORDS.has(t));
}

const sameWord = (a: string, b: string): boolean => a.startsWith(b) || b.startsWith(a);

/** Objections whose trigger shares keywords with the customer text; best first, library order breaks ties. */
export function matchObjections(cfg: PlaybookConfig, customerText: string, limit: number = PLAYBOOK_PROMPT_CAPS.objections) {
  const words = tokens(customerText);
  if (words.length === 0) return [];
  return cfg.objections
    .map((o, order) => {
      const trig = [...new Set(tokens(o.trigger))];
      return { o, order, score: trig.filter((t) => words.some((w) => sameWord(t, w))).length };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, limit)
    .map((x) => x.o);
}

const clip = (s: string, max: number): string => (s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`);

/**
 * Compact playbook context for one turn: the current stage (the previous detected one, discovery
 * for a new conversation), the closing style and only the objections matching the customer text.
 * Returns null when the playbook is disabled.
 */
export function buildPlaybookContext(
  cfg: PlaybookConfig,
  input: { previousStage: SalesStage | null; customerText: string },
): PlaybookPromptContext | null {
  if (!cfg.enabled) return null;
  const stage = input.previousStage ?? "discovery";
  return {
    stage,
    stageGuidance: clip(cfg.stages[stage], PLAYBOOK_PROMPT_CAPS.stage),
    closingStyle: cfg.closingStyle,
    objections: matchObjections(cfg, input.customerText).map((o) => ({
      id: o.id,
      trigger: clip(o.trigger, PLAYBOOK_PROMPT_CAPS.trigger),
      response: clip(o.response, PLAYBOOK_PROMPT_CAPS.response),
    })),
  };
}

/**
 * Keeps only values the playbook may store: a valid stage and an objection id that was actually
 * offered in this turn's prompt. Anything else is dropped, never trusted.
 */
export function sanitizeDetectedPlaybook(
  detected: { salesStage?: string | undefined; objection?: string | undefined },
  offeredObjectionIds: readonly string[],
): { salesStage?: SalesStage; objection?: string } {
  const out: { salesStage?: SalesStage; objection?: string } = {};
  if (isSalesStage(detected.salesStage)) out.salesStage = detected.salesStage;
  if (detected.objection && offeredObjectionIds.includes(detected.objection)) out.objection = detected.objection;
  return out;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
