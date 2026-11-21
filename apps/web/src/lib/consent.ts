/**
 * Cookie/tracking consent. Stored in localStorage (wrapped in try/catch: it can throw or come back
 * empty in private windows). Nothing marketing-related loads until the state is "accepted".
 */
export type ConsentState = "accepted" | "rejected" | "unset" | "unknown";

export const CONSENT_KEY = "crmwsp_consent";
const CONSENT_EVENT = "crmwsp:consent";

export function parseConsent(raw: string | null | undefined): "accepted" | "rejected" | "unset" {
  return raw === "accepted" || raw === "rejected" ? raw : "unset";
}

export function readConsent(): "accepted" | "rejected" | "unset" {
  try {
    return parseConsent(window.localStorage.getItem(CONSENT_KEY));
  } catch {
    return "unset";
  }
}

export function writeConsent(value: "accepted" | "rejected"): void {
  try {
    window.localStorage.setItem(CONSENT_KEY, value);
  } catch {
    // Storage unavailable: the choice only lasts for this page view.
    memoryChoice = value;
  }
  window.dispatchEvent(new Event(CONSENT_EVENT));
}

let memoryChoice: "accepted" | "rejected" | undefined;

/** Snapshot for useSyncExternalStore: falls back to the in-memory choice when storage is blocked. */
export function getConsentSnapshot(): "accepted" | "rejected" | "unset" {
  const stored = readConsent();
  return stored === "unset" && memoryChoice ? memoryChoice : stored;
}

/** Server render: no banner and no trackers. */
export const getServerConsentSnapshot = (): ConsentState => "unknown";

export function subscribeConsent(onChange: () => void): () => void {
  window.addEventListener(CONSENT_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CONSENT_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}
