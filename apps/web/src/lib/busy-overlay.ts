import { useSyncExternalStore } from "react";

/** Writes that must NOT cover the screen: chat actions, notifications and other high-frequency calls. */
const QUIET_PATHS = /^\/(conversations|inbox|notifications|events|attachments|search|auth\/(refresh|logout))(\/|\?|$)/;

/** True for writes that are real decisions (settings, channels, team, plan, catalog...). */
export function isBlockingRequest(method: string, path: string): boolean {
  if (method === "GET") return false;
  return !QUIET_PATHS.test(path);
}

let pending = 0;
const listeners = new Set<() => void>();
const emit = (): void => listeners.forEach((l) => l());

/** Marks one blocking request as running; returns the function that ends it. */
export function beginBusy(): () => void {
  pending += 1;
  emit();
  let done = false;
  return () => {
    if (done) return;
    done = true;
    pending -= 1;
    emit();
  };
}

export function useBusyCount(): number {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    () => pending,
    () => 0,
  );
}
