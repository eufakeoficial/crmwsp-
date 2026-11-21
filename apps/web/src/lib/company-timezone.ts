/** Zones shown first in the picker (LatAm + Spain). */
export const COMMON_TIMEZONES = [
  "America/Lima",
  "America/Bogota",
  "America/Mexico_City",
  "America/Santiago",
  "America/Argentina/Buenos_Aires",
  "America/Guayaquil",
  "America/La_Paz",
  "America/Caracas",
  "America/Montevideo",
  "Europe/Madrid",
] as const;

/** All IANA zones the runtime knows, common ones first (no duplicates) and the current one always included. */
export function timezoneOptions(current?: string, all?: readonly string[]): { common: string[]; others: string[] } {
  const list = all ?? (typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : []);
  const common = [...COMMON_TIMEZONES] as string[];
  const seen = new Set(common);
  const others: string[] = [];
  for (const z of [...list, ...(current ? [current] : [])]) {
    if (seen.has(z)) continue;
    seen.add(z);
    others.push(z);
  }
  others.sort();
  return { common, others };
}

/** Local time in `zone` as HH:mm, or null when the zone is invalid. */
export function formatZoneTime(zone: string, now: Date): string | null {
  try {
    return new Intl.DateTimeFormat("es", { timeZone: zone, hour: "2-digit", minute: "2-digit", hour12: false }).format(now);
  } catch {
    return null;
  }
}

/** Browser zone when it is a valid zone different from the stored one; otherwise null. */
export function suggestedZone(browserZone: string | undefined, stored: string): string | null {
  if (!browserZone || browserZone === stored) return null;
  return formatZoneTime(browserZone, new Date()) === null ? null : browserZone;
}
