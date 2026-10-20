import { aiApi, knowledgeApi } from "./ai-api";
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
}

export const EMPTY_PROGRESS: OnboardingProgress = { current: 0, done: {}, dismissed: false };

const key = (tenantId: string) => `crmwsp.onboarding.${tenantId}`;

export function loadProgress(tenantId: string): OnboardingProgress | null {
  try {
    const raw = window.localStorage.getItem(key(tenantId));
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<OnboardingProgress>;
    const current = typeof p.current === "number" ? Math.min(Math.max(Math.trunc(p.current), 0), ONBOARDING_STEPS.length - 1) : 0;
    return { current, done: p.done && typeof p.done === "object" ? p.done : {}, dismissed: p.dismissed === true };
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
}

/** Real-data checks over existing endpoints; a failed check counts as "not done" rather than blocking. */
export async function fetchOnboardingStatus(): Promise<OnboardingStatus> {
  const [products, sources, connection, channels] = await Promise.allSettled([
    productsApi.list({ limit: 1 }),
    knowledgeApi.listSources(),
    aiApi.getConnection(),
    channelsApi.list(),
  ]);
  return {
    hasProducts: products.status === "fulfilled" && products.value.items.length > 0,
    hasKnowledge: sources.status === "fulfilled" && sources.value.length > 0,
    hasAiKey: connection.status === "fulfilled" && connection.value !== null,
    hasChannel: channels.status === "fulfilled" && channels.value.items.some((c) => c.status === "active"),
  };
}

export interface ChecklistItem {
  step: OnboardingStep;
  label: string;
  done: boolean;
  href: string;
}

/** Items of the "Primeros pasos" card. Business/test have no data signal, so they follow saved progress. */
export function buildChecklist(status: OnboardingStatus, progress: OnboardingProgress | null): ChecklistItem[] {
  const done = progress?.done ?? {};
  return [
    { step: "business", label: "Elige tu tipo de negocio", done: done.business === true, href: "/app/onboarding" },
    { step: "prices", label: "Sube tu lista de precios", done: status.hasProducts, href: "/app/onboarding" },
    { step: "faq", label: "Añade tus preguntas frecuentes", done: status.hasKnowledge, href: "/app/onboarding" },
    { step: "ai", label: "Conecta tu IA", done: status.hasAiKey, href: "/app/settings/ai" },
    { step: "whatsapp", label: "Conecta WhatsApp", done: status.hasChannel, href: "/app/channels" },
    { step: "test", label: "Prueba tu bot", done: done.test === true, href: "/app/settings/ai/simulator" },
  ];
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
