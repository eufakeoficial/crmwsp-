import type { ChannelHealth, WalletBalance } from "@crmwsp/contracts";
import { formatRelative } from "./format";

export interface ChannelHealthText {
  inbound: string;
  outbound: { ok: boolean; error: string | null; when: string } | null;
}

/** Copy for the channel card: "Último mensaje recibido: hace 5 min" / "Último envío: falló — Authentication Failed". */
export function channelHealthText(health: ChannelHealth, now: Date = new Date()): ChannelHealthText {
  const out = health.lastOutbound;
  return {
    inbound: health.lastInboundAt ? `Último mensaje recibido: ${formatRelative(health.lastInboundAt, now)}` : "Aún no has recibido mensajes por este número",
    outbound: out ? { ok: out.ok, error: out.error, when: formatRelative(out.at, now) } : null,
  };
}

export const GUPSHUP_RECHARGE_URL = "https://www.gupshup.io";

/** "Saldo Gupshup: USD 3.50" (null when the balance is unavailable: the UI shows nothing). */
export function walletBalanceText(balance: WalletBalance): string | null {
  if (balance.status !== "ok") return null;
  const amount = balance.amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `Saldo Gupshup: ${balance.currency ? `${balance.currency} ` : ""}${amount}`;
}
