import type { ContactPanel, InboxCounts, LeadOrigin } from "@crmwsp/contracts";
import type { InboxListParams } from "@/lib/inbox-v2-api";

export type FolderId = "all" | "open" | "closed" | "mine" | "unassigned" | "reminders" | `tag:${string}`;
export type StatusFilter = "open" | "closed" | "all";

/** Left sidebar folder -> list query. Folders other than "all" fix their own status. */
export function folderParams(folder: FolderId, status: StatusFilter): InboxListParams {
  if (folder.startsWith("tag:")) return { status, tag: folder.slice(4) };
  switch (folder) {
    case "open":
      return { status: "open" };
    case "closed":
      return { status: "closed" };
    case "mine":
      return { status, assignedTo: "me" };
    case "unassigned":
      return { status, assignedTo: "unassigned" };
    case "reminders":
      return { status: "all", reminders: true };
    default:
      return { status };
  }
}

/** True when the folder decides the status itself, so the toolbar "Estado" selector is moot. */
export function folderFixesStatus(folder: FolderId): boolean {
  return folder === "open" || folder === "closed" || folder === "reminders";
}

/** Compact relative time for the chat list: "ahora", "5m", "8h", "1d", "3sem". */
export function compactRelative(date: Date | string | number, now: Date = new Date()): string {
  const diff = Math.max(0, now.getTime() - new Date(date).getTime());
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "ahora";
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  if (d < 365) return `${Math.floor(d / 7)}sem`;
  return `${Math.floor(d / 365)}a`;
}

export function folderCount(counts: InboxCounts | null, folder: FolderId): number | null {
  if (!counts) return null;
  switch (folder) {
    case "all":
      return counts.unread;
    case "open":
      return counts.open;
    case "closed":
      return counts.closed;
    case "mine":
      return counts.mine;
    case "unassigned":
      return counts.unassigned;
    case "reminders":
      return counts.remindersDue;
    default:
      return counts.tags.find((t) => `tag:${t.name}` === folder)?.count ?? 0;
  }
}

export const ORIGIN_LABELS: Record<LeadOrigin, string> = {
  ad: "Anuncio",
  import: "Importado",
  api: "API",
  whatsapp: "WhatsApp",
  manual: "Manual",
};

export function originLabel(panel: Pick<ContactPanel, "origin" | "ad">): string {
  if (panel.origin === "ad") return panel.ad?.headline ? `Anuncio: ${panel.ad.headline}` : "Anuncio";
  return ORIGIN_LABELS[panel.origin];
}

/** Local time of the contact ("14:05") or null when the timezone is unknown/invalid. */
export function localTimeIn(timezone: string | null, now: Date = new Date()): string | null {
  if (!timezone) return null;
  try {
    return new Intl.DateTimeFormat("es", { hour: "2-digit", minute: "2-digit", timeZone: timezone }).format(now);
  } catch {
    return null;
  }
}

export const REMINDER_PRESETS = [
  { preset: "20m", label: "En 20 minutos" },
  { preset: "1h", label: "En 1 hora" },
  { preset: "6h", label: "En 6 horas" },
  { preset: "12h", label: "En 12 horas" },
] as const;

/** `<input type="datetime-local">` value ("2026-10-21T09:30", local time) to an ISO instant, or null. */
export function localInputToIso(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export const IMPROVE_STYLES = [
  { style: "professional", label: "Más profesional" },
  { style: "friendly", label: "Más amable" },
  { style: "shorter", label: "Más corto" },
] as const;

export const TAG_COLORS = ["#2563eb", "#16a34a", "#dc2626", "#d97706", "#7c3aed", "#0891b2", "#db2777", "#475569"] as const;
export const COMMON_EMOJIS = ["😀", "😊", "😉", "🙏", "👍", "👏", "🎉", "❤️", "🔥", "✅", "📌", "📞", "💬", "⏰", "💰", "🚚"] as const;
