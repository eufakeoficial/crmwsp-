"use client";

import type { WalletBalance } from "@crmwsp/contracts";
import { ExternalLink, Wallet } from "lucide-react";
import { useEffect, useState } from "react";
import { StatusChip } from "@/components/ui";
import { GUPSHUP_RECHARGE_URL, walletBalanceText } from "@/lib/channel-health";
import { channelsApi } from "@/lib/inbox-api";

/** Gupshup wallet balance with a low-balance badge and a top-up link. Renders nothing while unknown/unavailable. */
export function WalletBalanceLine({ channelId }: { channelId: string }) {
  const [balance, setBalance] = useState<WalletBalance | null>(null);
  useEffect(() => {
    let alive = true;
    channelsApi.balance(channelId).then(
      (b) => alive && setBalance(b),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [channelId]);
  const text = balance ? walletBalanceText(balance) : null;
  if (!balance || balance.status !== "ok" || !text) return null;
  return (
    <div className="flex flex-col gap-1 text-sm" data-testid="wallet-balance">
      <p className="m-0 flex flex-wrap items-center gap-2">
        <Wallet aria-hidden className="size-4 text-muted" />
        {text}
        {balance.low ? <StatusChip label="Saldo bajo" tone="danger" /> : null}
      </p>
      <p className="m-0 text-xs text-muted">
        Este saldo paga los mensajes de WhatsApp.{" "}
        <a href={GUPSHUP_RECHARGE_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold underline">
          Recargar saldo en Gupshup<ExternalLink aria-hidden className="size-3" />
        </a>
      </p>
    </div>
  );
}
