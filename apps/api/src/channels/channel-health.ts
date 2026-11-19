import type { ChannelHealth } from "@crmwsp/contracts";

export type InboundRow = {
  channel_id: string;
  at: string | null;
};

export type OutboundRow = {
  channel_id: string;
  status: string;
  at: string;
  error_message: string | null;
  error_code: string | null;
};

const MAX_ERROR_CHARS = 160;

/** Fallback texts for errors stored without a provider message (see apps/worker outbound.ts sanitizeError). */
const CODE_TEXT: Record<string, string> = {
  credentials_unavailable: "No se pudieron leer las credenciales del canal",
  unrecoverable: "Error no recuperable",
  internal_error: "Error interno",
  provider_error: "Error del proveedor",
};

function errorText(row: OutboundRow): string {
  const message = row.error_message?.trim();
  if (message) return message.slice(0, MAX_ERROR_CHARS);
  if (row.error_code) return CODE_TEXT[row.error_code] ?? "Error desconocido";
  return "Error desconocido";
}

const iso = (v: string): string => new Date(v).toISOString();

/** Pure assembly of the per-channel health from the two aggregate queries. */
export function buildChannelHealth(channelIds: string[], inbound: InboundRow[], outbound: OutboundRow[]): ChannelHealth[] {
  const inboundBy = new Map(inbound.map((r) => [r.channel_id, r.at]));
  const outboundBy = new Map(outbound.map((r) => [r.channel_id, r]));
  return channelIds.map((channelId) => {
    const lastIn = inboundBy.get(channelId) ?? null;
    const out = outboundBy.get(channelId);
    return {
      channelId,
      lastInboundAt: lastIn ? iso(lastIn) : null,
      lastOutbound: out
        ? out.status === "failed"
          ? { ok: false, at: iso(out.at), error: errorText(out) }
          : { ok: true, at: iso(out.at), error: null }
        : null,
    };
  });
}
