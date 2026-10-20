import type { AiProvider } from "./ai-schemas";

export const PROVIDER_BASE_URLS: Readonly<Record<Exclude<AiProvider, "custom">, string>> = {
  openai: "https://api.openai.com/v1",
  openrouter: "https://openrouter.ai/api/v1",
  deepseek: "https://api.deepseek.com/v1",
};

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "0.0.0.0"]);

export type BaseUrlCheck = { ok: true; url: string } | { ok: false; reason: string };

/**
 * Custom provider base URL: https only, no localhost unless running in dev
 * (the server enforces the real anti-SSRF rules, ADR 0008).
 */
export function validateBaseUrl(raw: string, isDev: boolean = process.env.NODE_ENV !== "production"): BaseUrlCheck {
  const value = raw.trim();
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, reason: "Introduce una URL válida, por ejemplo https://api.miproveedor.com/v1." };
  }
  const local = LOCAL_HOSTS.has(url.hostname);
  if (local && isDev) return { ok: true, url: value.replace(/\/+$/, "") };
  if (url.protocol !== "https:") return { ok: false, reason: "La URL debe empezar por https://." };
  if (local) return { ok: false, reason: "No se admite localhost fuera del entorno de desarrollo." };
  return { ok: true, url: value.replace(/\/+$/, "") };
}

/** Share of the monthly budget spent, as an integer 0..100+ (null without a budget). */
export function budgetPercent(spentMinor: number, budgetMinor: number | null | undefined): number | null {
  if (!budgetMinor || budgetMinor <= 0) return null;
  return Math.max(0, Math.round((spentMinor / budgetMinor) * 100));
}

export type BudgetLevel = "ok" | "warn" | "exceeded";

/** 80 % warns; 100 % switches automatic AI off (never the inbox). */
export function budgetLevel(percent: number | null): BudgetLevel {
  if (percent === null || percent < 80) return "ok";
  return percent >= 100 ? "exceeded" : "warn";
}

/** Money typed by the user ("12,50") to minor units. NaN-safe: returns undefined if invalid. */
export function toMinor(input: string): number | undefined {
  const n = Number(input.trim().replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : undefined;
}

export function fromMinor(minor: number): string {
  return String(minor / 100);
}
