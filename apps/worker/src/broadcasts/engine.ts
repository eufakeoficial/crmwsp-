/**
 * Broadcast dispatch engine (pure orchestration over a store; the Postgres adapter is pg-store.ts).
 * Each pass, per tenant: promote due scheduled campaigns to `sending`, then materialise at most
 * `batchSize` recipients into queued template messages (rate limit), re-checking marketing
 * consent at send time. A recipient gets at most one message (idempotent per campaign+contact).
 */

export interface SendingBroadcast {
  id: string;
  channelConnectionId: string;
  templateBody: string;
}

export interface PendingRecipient {
  id: string;
  contactId: string;
  params: string[];
  /** Current marketing consent of the contact (re-read at send time). */
  marketingConsent: "granted" | "revoked" | null;
}

export interface BroadcastStore {
  /** scheduled -> sending for campaigns whose scheduled_at <= now. Returns how many moved. */
  promoteDue(now: Date): Promise<number>;
  listSending(): Promise<SendingBroadcast[]>;
  /** Locks (SKIP LOCKED) pending recipients without a message yet. */
  lockPending(broadcastId: string, limit: number): Promise<PendingRecipient[]>;
  /** Creates the queued outbound message for a recipient and links it; returns the message id. */
  createMessage(b: SendingBroadcast, r: PendingRecipient, body: string): Promise<string>;
  markSkipped(recipientId: string, code: string): Promise<void>;
  /** Recipients still `pending` (with or without a message). */
  countPending(broadcastId: string): Promise<number>;
  markCompleted(broadcastId: string, now: Date): Promise<void>;
}

export interface BroadcastPassResult {
  promoted: number;
  messageIds: string[];
  skipped: number;
  completed: number;
}

/** Renders `{{n}}` with the recipient's params, for the inbox copy of the message. */
export function renderTemplateBody(body: string, params: readonly string[]): string {
  return body.replace(/\{\{\s*(\d+)\s*\}\}/g, (m, n: string) => params[Number(n) - 1] ?? m);
}

export async function runBroadcastPass(store: BroadcastStore, now: Date, batchSize: number): Promise<BroadcastPassResult> {
  const res: BroadcastPassResult = { promoted: await store.promoteDue(now), messageIds: [], skipped: 0, completed: 0 };
  let budget = batchSize;
  for (const b of await store.listSending()) {
    if (budget > 0) {
      const pending = await store.lockPending(b.id, budget);
      for (const r of pending) {
        budget--;
        if (r.marketingConsent !== "granted") {
          await store.markSkipped(r.id, "no_marketing_consent");
          res.skipped++;
          continue;
        }
        res.messageIds.push(await store.createMessage(b, r, renderTemplateBody(b.templateBody, r.params)));
      }
    }
    if ((await store.countPending(b.id)) === 0) {
      await store.markCompleted(b.id, now);
      res.completed++;
    }
  }
  return res;
}
