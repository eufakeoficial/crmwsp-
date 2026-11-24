const pad = (n: number) => String(n).padStart(2, "0");

/**
 * ISO instant -> value for an `<input type="datetime-local">`, in the browser's local wall time.
 * Must mirror `localInputToIso`; slicing the ISO string would show UTC as if it were local time
 * and shift the value by the zone offset on every re-render.
 */
export const isoToLocalInput = (iso: string | null): string => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** `<input type="datetime-local">` value (wall time in the browser zone) -> ISO instant. */
export const localInputToIso = (v: string): string | null => (v ? new Date(v).toISOString() : null);
