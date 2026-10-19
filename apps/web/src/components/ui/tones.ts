export type Tone = "success" | "danger" | "warning" | "info" | "amber" | "lime-soft" | "lime" | "paper";

/** Soft background + text. Full class names so Tailwind detects them. */
export const TONE_SOFT: Readonly<Record<Tone, string>> = {
  success: "bg-success-soft text-success",
  danger: "bg-danger-soft text-danger",
  warning: "bg-warning-soft text-warning",
  info: "bg-info-soft text-info",
  amber: "bg-amber-soft text-amber-ink",
  "lime-soft": "bg-lime-soft text-ink",
  lime: "bg-lime text-ink",
  paper: "bg-paper text-ink-3",
};

/** Background only: decorative blobs and icon boxes. */
export const TONE_BG: Readonly<Record<Tone, string>> = {
  success: "bg-success-soft",
  danger: "bg-danger-soft",
  warning: "bg-warning-soft",
  info: "bg-info-soft",
  amber: "bg-amber-soft",
  "lime-soft": "bg-lime-soft",
  lime: "bg-lime",
  paper: "bg-paper",
};
