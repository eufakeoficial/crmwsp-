/**
 * Meta account/number/template events (WhatsApp Cloud API v3 webhooks, forwarded by the BSP) and
 * what they mean for a channel (ADR 0021, T2d). Meta publishes no numeric thresholds: the
 * severity here is our own reading of the event names in the research (§1.4, §4).
 */

export const accountEventFields = [
  "phone_number_quality_update",
  "account_update",
  "message_template_status_update",
  "message_template_quality_update",
] as const;
export type AccountEventField = (typeof accountEventFields)[number];

export type AccountEventSeverity = "info" | "warning" | "critical";
export type ChannelQuality = "GREEN" | "YELLOW" | "RED" | "UNKNOWN";
export type ChannelAccountStatus = "ok" | "flagged" | "restricted" | "disabled";

export interface AccountEventInput {
  field: AccountEventField;
  event: string | null;
  /** Template quality score (message_template_quality_update). */
  quality?: string | null;
}

export interface AccountEventAssessment {
  severity: AccountEventSeverity;
  /** New quality of the NUMBER (null = unchanged). */
  quality: ChannelQuality | null;
  /** New account status of the number (null = unchanged). */
  accountStatus: ChannelAccountStatus | null;
}

const up = (v: string | null | undefined) => (v ?? "").trim().toUpperCase();

export function assessAccountEvent(e: AccountEventInput): AccountEventAssessment {
  const ev = up(e.event);
  switch (e.field) {
    case "phone_number_quality_update":
      if (ev === "DOWNGRADE") return { severity: "critical", quality: "RED", accountStatus: "flagged" };
      if (ev === "FLAGGED") return { severity: "warning", quality: "RED", accountStatus: "flagged" };
      if (ev === "UNFLAGGED" || ev === "UPGRADE") return { severity: "info", quality: "GREEN", accountStatus: "ok" };
      return { severity: "info", quality: null, accountStatus: null };
    case "account_update":
      if (ev === "DISABLED_UPDATE" || ev === "BAN" || ev === "ACCOUNT_DELETED") return { severity: "critical", quality: null, accountStatus: "disabled" };
      if (ev === "ACCOUNT_RESTRICTION" || ev === "ACCOUNT_VIOLATION") return { severity: "critical", quality: null, accountStatus: "restricted" };
      return { severity: "info", quality: null, accountStatus: null };
    case "message_template_status_update":
      if (ev === "DISABLED") return { severity: "critical", quality: null, accountStatus: null };
      if (ev === "PAUSED" || ev === "REJECTED" || ev === "FLAGGED") return { severity: "warning", quality: null, accountStatus: null };
      return { severity: "info", quality: null, accountStatus: null };
    case "message_template_quality_update":
      return { severity: up(e.quality) === "RED" ? "warning" : "info", quality: null, accountStatus: null };
  }
}

/** Template status our `message_templates.status` takes from a status event (null = no change). */
export function templateStatusFromEvent(event: string | null): "approved" | "rejected" | "paused" | "disabled" | "pending" | null {
  switch (up(event)) {
    case "APPROVED":
      return "approved";
    case "REJECTED":
      return "rejected";
    case "PAUSED":
      return "paused";
    case "DISABLED":
      return "disabled";
    case "PENDING":
    case "IN_APPEAL":
      return "pending";
    default:
      return null;
  }
}
