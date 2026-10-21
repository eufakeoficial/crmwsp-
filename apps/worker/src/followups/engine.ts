import { decideDispatch, type ConsentState, type DispatchDecision } from "@crmwsp/domain";
import type { FollowUpSettings } from "@crmwsp/contracts";

/** One due follow-up with everything the decision needs (loaded under its row lock). */
export interface DueFollowUp {
  id: string;
  conversationId: string;
  status: string;
  scheduledAt: Date;
  createdAt: Date;
  messageBody: string | null;
  templateId: string | null;
  lastInboundAt: Date | null;
  conversationResolved: boolean;
  consent: ConsentState;
  /** Approved template on the conversation's channel, or null (missing / not approved / other channel). */
  approvedTemplate: { id: string; body: string } | null;
  orderStatus: string | null;
}

/** Storage port used by the dispatcher; the Postgres adapter runs inside one tenant transaction. */
export interface FollowUpStore {
  /** Locks up to `limit` due `scheduled` follow-ups (FOR UPDATE SKIP LOCKED). */
  lockDue(now: Date, limit: number): Promise<DueFollowUp[]>;
  /**
   * Inserts the queued outbound message keyed by the follow-up id (idempotent: an existing message
   * for the same follow-up is returned instead of a new one).
   */
  insertQueuedMessage(f: DueFollowUp, kind: "text" | "template", body: string): Promise<string>;
  markSent(id: string, messageId: string, templateId: string | null, now: Date): Promise<void>;
  markSkipped(id: string, reason: string, now: Date): Promise<void>;
  markCancelled(id: string, reason: string, now: Date): Promise<void>;
  defer(id: string, until: Date, now: Date): Promise<void>;
}

export interface DispatchOutcome {
  followUpId: string;
  decision: DispatchDecision["action"];
  reason?: string;
  /** Present when a message must be enqueued on the outbound queue after commit. */
  messageId?: string;
}

/**
 * Applies the decision to every locked due follow-up. Every write is guarded by
 * `status = 'scheduled'`, and the message insert is keyed by the follow-up id, so a retried tick
 * (crash between commit and enqueue, stalled job) never creates a second message.
 */
export async function dispatchDue(
  store: FollowUpStore,
  settings: Pick<FollowUpSettings, "quietHours">,
  timeZone: string,
  now: Date,
  limit = 50,
): Promise<DispatchOutcome[]> {
  const out: DispatchOutcome[] = [];
  for (const f of await store.lockDue(now, limit)) {
    const d = decideDispatch({
      now,
      status: f.status,
      scheduledAt: f.scheduledAt,
      createdAt: f.createdAt,
      lastInboundAt: f.lastInboundAt,
      conversationResolved: f.conversationResolved,
      consent: f.consent,
      messageBody: f.messageBody,
      approvedTemplate: f.approvedTemplate,
      orderStatus: f.orderStatus,
      quietHours: settings.quietHours,
      timeZone,
    });
    switch (d.action) {
      case "send_text":
      case "send_template": {
        const kind = d.action === "send_text" ? "text" : "template";
        const messageId = await store.insertQueuedMessage(f, kind, d.body);
        await store.markSent(f.id, messageId, d.action === "send_template" ? d.templateId : null, now);
        out.push({ followUpId: f.id, decision: d.action, messageId });
        break;
      }
      case "skip":
        await store.markSkipped(f.id, d.reason, now);
        out.push({ followUpId: f.id, decision: "skip", reason: d.reason });
        break;
      case "cancel":
        await store.markCancelled(f.id, d.reason, now);
        out.push({ followUpId: f.id, decision: "cancel", reason: d.reason });
        break;
      case "defer":
        await store.defer(f.id, d.until, now);
        out.push({ followUpId: f.id, decision: "defer" });
        break;
      case "noop":
        break;
    }
  }
  return out;
}
