import { AI_PROVIDER_BASE_URLS, type AiProvider } from "@crmwsp/contracts";
import { majorToMinor, minorToInput } from "./format";

/** Same fixed URLs the API uses (shared in contracts). */
export const PROVIDER_BASE_URLS: Readonly<Record<Exclude<AiProvider, "custom">, string>> = AI_PROVIDER_BASE_URLS;

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "0.0.0.0"]);

export type BaseUrlCheck = { ok: true; url: string } | { ok: false; reason: string };

/**
 * Custom provider base URL: https only, no localhost unless running in dev
 * (the server enforces the real anti-SSRF rules, ADR 0008).
 */
// Fail closed (CN-011): only an explicit development/test NODE_ENV enables the localhost allowance.
export function validateBaseUrl(
  raw: string,
  isDev: boolean = process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test",
): BaseUrlCheck {
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

/** Money typed by the user ("12,50") to minor units of `currency`; undefined if invalid. */
export function toMinor(input: string, currency: string): number | undefined {
  return majorToMinor(input, currency);
}

export function fromMinor(minor: number | null | undefined, currency: string): string {
  return minor === null || minor === undefined ? "" : minorToInput(minor, currency);
}
