"use client";

import type { InboxConversation, OrderExtractionDto } from "@crmwsp/contracts";
import { useEffect, useState } from "react";
import { orderExtractionsApi } from "@/lib/order-extractions-api";
import { OrderExtractionCard } from "./OrderExtractionCard";

const PENDING: ReadonlySet<OrderExtractionDto["status"]> = new Set(["needs_confirmation", "ready"]);

/** Orders detected in the open conversation that still wait for the agent (F4); renders nothing otherwise. */
export function PendingOrderExtractions({ conversation }: { conversation: InboxConversation }) {
  const [items, setItems] = useState<OrderExtractionDto[]>([]);

  useEffect(() => {
    let alive = true;
    setItems([]);
    orderExtractionsApi
      .list(conversation.id)
      .then((res) => {
        if (alive) setItems(res.items.filter((e) => PENDING.has(e.status)));
      })
      .catch(() => {
        // Best effort: the thread works without the card.
      });
    return () => {
      alive = false;
    };
  }, [conversation.id, conversation.lastMessageAt]);

  if (items.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      {items.map((e) => (
        <OrderExtractionCard
          key={e.id}
          extraction={e}
          onChange={(next) =>
            setItems((prev) => (PENDING.has(next.status) ? prev.map((x) => (x.id === next.id ? next : x)) : prev.filter((x) => x.id !== next.id)))
          }
        />
      ))}
    </div>
  );
}
