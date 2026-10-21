import { aiApi, knowledgeApi } from "./ai-api";
import { api } from "./api";
import { productsApi } from "./commerce-api";
import { channelsApi } from "./inbox-api";

/**
 * Onboarding state. There is no tenant-settings endpoint the web can write to, so progress lives in
 * localStorage (per tenant, per browser). The checklist itself is always computed from real data.
 */
export const ONBOARDING_STEPS = ["business", "prices", "faq", "ai", "whatsapp", "test"] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export interface OnboardingProgress {
  /** Index in ONBOARDING_STEPS of the step the wizard reopens on. */
  current: number;
  /** Steps with no data signal that the user completed (business template, bot test). */
  done: Partial<Record<OnboardingStep, boolean>>;
  dismissed: boolean;
  /** Home checklist steps the user marked as done by hand (simulator, team). */
  manual?: Partial<Record<ChecklistStep, boolean>>;
}

export type ChecklistStep = "whatsapp" | "content" | "ai" | "simulator" | "team";

export const EMPTY_PROGRESS: OnboardingProgress = { current: 0, done: {}, dismissed: false, manual: {} };

const key = (tenantId: string) => `crmwsp.onboarding.${tenantId}`;

export function loadProgress(tenantId: string): OnboardingProgress | null {
  try {
    const raw = window.localStorage.getItem(key(tenantId));
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<OnboardingProgress>;
    const current = typeof p.current === "number" ? Math.min(Math.max(Math.trunc(p.current), 0), ONBOARDING_STEPS.length - 1) : 0;
    return {
      current,
      done: p.done && typeof p.done === "object" ? p.done : {},
      dismissed: p.dismissed === true,
      manual: p.manual && typeof p.manual === "object" ? p.manual : {},
    };
  } catch {
    return null;
  }
}

export function saveProgress(tenantId: string, progress: OnboardingProgress): void {
  try {
    window.localStorage.setItem(key(tenantId), JSON.stringify(progress));
  } catch {
    /* storage unavailable: the wizard still works for this session */
  }
}

export interface OnboardingStatus {
  hasProducts: boolean;
  hasKnowledge: boolean;
  hasAiKey: boolean;
  hasChannel: boolean;
  /** The agent config was saved with a prompt (tone/instructions); the API default has an empty one. */
  hasAgentConfig: boolean;
  /** The tenant has 2 or more members. */
  hasTeam: boolean;
}

/** Real-data checks over existing endpoints; a failed check counts as "not done" rather than blocking. */
export async function fetchOnboardingStatus(): Promise<OnboardingStatus> {
  const [products, sources, connection, channels, agent, members] = await Promise.allSettled([
    productsApi.list({ limit: 1 }),
    knowledgeApi.listSources(),
    aiApi.getConnection(),
    channelsApi.list(),
    aiApi.getAgentConfig(),
    api.members(),
  ]);
  return {
    hasProducts: products.status === "fulfilled" && products.value.items.length > 0,
    hasKnowledge: sources.status === "fulfilled" && sources.value.length > 0,
    hasAiKey: connection.status === "fulfilled" && connection.value !== null,
    hasChannel: channels.status === "fulfilled" && channels.value.items.some((c) => c.status === "active"),
    hasAgentConfig: agent.status === "fulfilled" && agent.value.systemPrompt.trim().length > 0,
    hasTeam: members.status === "fulfilled" && members.value.items.length >= 2,
  };
}

export interface ChecklistItem {
  step: ChecklistStep;
  label: string;
  /** One plain sentence on what the step is for. */
  hint: string;
  done: boolean;
  href: string;
  cta: string;
  optional?: boolean;
  /** No data signal exists: the user marks it as done by hand (stored in progress). */
  manual?: boolean;
}

/**
 * Items of the "Primeros pasos" card, in order. Done flags come from real data; only the simulator has no
 * signal (runs are not stored), so it follows the manual flag saved in progress (`done.test`).
 */
export function buildChecklist(status: OnboardingStatus, progress: OnboardingProgress | null): ChecklistItem[] {
  const manual = progress?.manual ?? {};
  return [
    { step: "whatsapp", label: "Conectar tu WhatsApp", hint: "Para recibir y responder mensajes desde aquí.", done: status.hasChannel, href: "/app/channels", cta: "Conectar" },
    { step: "content", label: "Cargar tus productos o conocimiento", hint: "La IA responde con lo que cargues: precios, servicios y preguntas frecuentes.", done: status.hasProducts || status.hasKnowledge, href: status.hasProducts ? "/app/settings/knowledge" : "/app/products", cta: "Cargar" },
    { step: "ai", label: "Configurar la IA", hint: "Elige el tono y si la IA redacta o responde sola.", done: status.hasAgentConfig, href: "/app/ai", cta: "Configurar" },
    { step: "simulator", label: "Probar en el simulador", hint: "Prueba cómo responde sin enviar mensajes reales.", done: manual.simulator === true, href: "/app/settings/ai/simulator", cta: "Probar", manual: true },
    { step: "team", label: "Invitar a tu equipo", hint: "Opcional: suma a quienes atienden a tus clientes.", done: status.hasTeam || manual.team === true, href: "/app/team", cta: "Invitar", optional: true, manual: true },
  ];
}

/** Progress over the required steps only; optional steps never block completion. */
export function checklistProgress(items: readonly ChecklistItem[]): { done: number; total: number; complete: boolean } {
  const required = items.filter((i) => !i.optional);
  const done = required.filter((i) => i.done).length;
  return { done, total: required.length, complete: done === required.length };
}

/** Step completion inside the wizard: data signal when there is one, saved flag otherwise. */
export function stepDone(step: OnboardingStep, status: OnboardingStatus | null, progress: OnboardingProgress): boolean {
  if (progress.done[step]) return true;
  if (!status) return false;
  if (step === "prices") return status.hasProducts;
  if (step === "faq") return status.hasKnowledge;
  if (step === "ai") return status.hasAiKey;
  if (step === "whatsapp") return status.hasChannel;
  return false;
}
