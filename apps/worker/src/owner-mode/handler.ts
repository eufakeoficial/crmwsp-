import type { OwnerCommandInterpretation, OwnerIntent } from "@crmwsp/contracts";
import {
  aiActions,
  auditEvents,
  contacts,
  conversations,
  decideAiActionAsUser,
  findVerifiedOwner,
  hashOwnerSecret,
  isUuid,
  messages,
  newOwnerSecret,
  ownerCommands,
  ownerPhones,
  ownerSecretMatches,
  payments,
  quotes,
  setTenantAiPaused,
  tenants,
  withTenant,
  type Database,
  type OwnerCommand,
  type Transaction,
} from "@crmwsp/db";
import {
  OWNER_HELP_TEXT,
  OWNER_MODE_LIMITS,
  formatMinor,
  isMutatingIntent,
  isRateLimited,
  parseOwnerReply,
  parseOwnerShortcut,
  quoteAsData,
} from "@crmwsp/domain";
import { UnrecoverableError, type Queue } from "bullmq";
import { and, desc, eq, gt, gte, ilike, inArray, ne, or, sql } from "drizzle-orm";
import {
  AI_JOB_OPTIONS,
  EXECUTE_AI_ACTION_JOB,
  SEND_MESSAGE_JOB,
  SEND_MESSAGE_JOB_OPTIONS,
  type SendMessageJobData,
} from "../queue.js";
import type { Logger } from "../processors.js";
import type { OwnerInterpreter, OwnerSender } from "./ports.js";
import type { OwnerCommandJobData } from "./queue.js";

/** Audit source of every owner-mode command. */
export const OWNER_SOURCE = "owner_whatsapp";
const WINDOW_24H_MS = 24 * 3600 * 1000;
const LIST_LIMIT = 10;

export interface OwnerModeDeps {
  db: Database;
  send: OwnerSender;
  /** Absent: only slash shortcuts are understood. */
  interpret?: OwnerInterpreter;
  /** `ai` queue, for approved actions (execute-ai-action). */
  aiQueue?: Pick<Queue, "add">;
  /** `outbound` queue, for confirmed customer replies. */
  outboundQueue?: Pick<Queue, "add">;
  logger?: Logger;
  now?: () => Date;
}

export type OwnerCommandOutcome =
  | { outcome: "skipped"; reason: "already_handled" | "not_found" }
  | { outcome: "rejected"; reason: "not_owner" | "rate_limited" }
  | { outcome: "answered"; intent: OwnerIntent | "confirm" | "cancel" }
  | { outcome: "awaiting_confirmation"; intent: OwnerIntent }
  | { outcome: "confirmed"; intent: OwnerIntent; pendingId: string }
  | { outcome: "confirmation_failed" };

type Pending = { intent: OwnerIntent; payload: Record<string, unknown>; summary: string };
type AfterCommit = Array<() => Promise<void>>;

const silent: Logger = { info: () => {}, warn: () => {}, error: () => {} };

function assertJob(data: unknown): OwnerCommandJobData {
  const d = data as Partial<OwnerCommandJobData> | null;
  if (!d || !isUuid(d.tenantId) || !isUuid(d.commandId)) throw new UnrecoverableError("invalid job data");
  return { tenantId: d.tenantId, commandId: d.commandId };
}

async function audit(tx: Transaction, cmd: OwnerCommand, action: string, diff: Record<string, unknown>): Promise<void> {
  await tx.insert(auditEvents).values({
    tenantId: cmd.tenantId,
    actorType: "user",
    actorId: cmd.userId,
    entity: "owner_command",
    entityId: cmd.id,
    action,
    diff: { source: OWNER_SOURCE, ...diff },
  });
}

/** Start of "today" in the tenant time zone, computed by Postgres. */
async function dayStart(tx: Transaction, now: Date): Promise<Date> {
  const [t] = await tx.select({ tz: tenants.timezone }).from(tenants).limit(1);
  const tz = t?.tz ?? "UTC";
  const rows = await tx.execute<{ start: string }>(
    sql`select (date_trunc('day', ${now.toISOString()}::timestamptz at time zone ${tz}) at time zone ${tz})::text as start`,
  );
  const start = rows[0]?.start;
  return start ? new Date(start) : new Date(now.getTime() - 24 * 3600 * 1000);
}

async function paidSince(tx: Transaction, since: Date): Promise<{ count: number; byCurrency: string }> {
  const rows = await tx
    .select({ currency: payments.currency, total: sql<string>`sum(${payments.amountMinor})::text`, n: sql<number>`count(*)::int` })
    .from(payments)
    .where(and(eq(payments.status, "succeeded"), gte(payments.paidAt, since)))
    .groupBy(payments.currency);
  const count = rows.reduce((a, r) => a + r.n, 0);
  const byCurrency = rows.length ? rows.map((r) => formatMinor(BigInt(r.total), r.currency)).join(" · ") : "0";
  return { count, byCurrency };
}

async function pendingActionsList(tx: Transaction): Promise<Array<{ id: string; type: string; contactName: string | null }>> {
  return tx
    .select({ id: aiActions.id, type: aiActions.type, contactName: sql<string | null>`coalesce(${contacts.name}, ${contacts.phoneE164})` })
    .from(aiActions)
    .leftJoin(conversations, eq(conversations.id, aiActions.conversationId))
    .leftJoin(contacts, eq(contacts.id, conversations.contactId))
    .where(eq(aiActions.status, "pending_approval"))
    .orderBy(desc(aiActions.createdAt), desc(aiActions.id))
    .limit(LIST_LIMIT);
}

/** "2" = second item of /pendientes; "1a2b3c4d" = id prefix (≥ 6 hex chars, unique). */
async function resolveActionRef(tx: Transaction, ref: string | null): Promise<{ id: string; type: string } | string> {
  const r = (ref ?? "").trim().toLowerCase();
  if (!r) return "Indica qué acción: usa /pendientes y luego «/aprobar 1».";
  const list = await pendingActionsList(tx);
  if (/^\d{1,2}$/u.test(r)) {
    const item = list[Number(r) - 1];
    return item ? { id: item.id, type: item.type } : "No hay una acción pendiente con ese número.";
  }
  if (!/^[0-9a-f-]{6,36}$/u.test(r)) return "Referencia no válida. Usa el número de /pendientes.";
  const matches = await tx
    .select({ id: aiActions.id, type: aiActions.type })
    .from(aiActions)
    .where(and(eq(aiActions.status, "pending_approval"), sql`${aiActions.id}::text like ${`${r}%`}`))
    .limit(2);
  if (matches.length !== 1 || !matches[0]) return matches.length ? "Referencia ambigua." : "No encontré esa acción pendiente.";
  return matches[0];
}

function escapeLike(q: string): string {
  return q.replace(/[\\%_]/gu, (c) => `\\${c}`);
}

/** Read-only intents: compute the answer. Mutating intents: validate and describe what will happen. */
async function plan(
  tx: Transaction,
  cmd: OwnerCommand,
  c: OwnerCommandInterpretation,
  now: Date,
): Promise<{ reply: string } | { pending: Pending } | { reply: string; error: true }> {
  switch (c.intent) {
    case "help":
    case "unknown":
      return { reply: c.intent === "unknown" ? `No entendí la petición.\n${OWNER_HELP_TEXT}` : OWNER_HELP_TEXT };
    case "daily_summary": {
      const start = await dayStart(tx, now);
      const [leads] = await tx.select({ n: sql<number>`count(*)::int` }).from(contacts).where(gte(contacts.createdAt, start));
      const [pq] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(quotes)
        .where(inArray(quotes.status, ["pending_approval", "sent"]));
      const [pa] = await tx.select({ n: sql<number>`count(*)::int` }).from(aiActions).where(eq(aiActions.status, "pending_approval"));
      const paid = await paidSince(tx, start);
      return {
        reply: [
          "Resumen de hoy:",
          `• Leads nuevos: ${leads?.n ?? 0}`,
          `• Presupuestos pendientes: ${pq?.n ?? 0}`,
          `• Acciones por aprobar: ${pa?.n ?? 0}`,
          `• Cobrado hoy (${paid.count} pagos): ${paid.byCurrency}`,
        ].join("\n"),
      };
    }
    case "pending_quotes": {
      const rows = await tx
        .select({ number: quotes.number, status: quotes.status, total: quotes.totalMinor, currency: quotes.currency, name: contacts.name, phone: contacts.phoneE164 })
        .from(quotes)
        .innerJoin(contacts, eq(contacts.id, quotes.contactId))
        .where(inArray(quotes.status, ["pending_approval", "sent"]))
        .orderBy(desc(quotes.createdAt))
        .limit(LIST_LIMIT);
      if (!rows.length) return { reply: "No hay presupuestos pendientes." };
      return {
        reply: [
          "Presupuestos pendientes:",
          ...rows.map(
            (q) => `• ${q.number} ${quoteAsData(q.name ?? q.phone, 60)} — ${formatMinor(q.total, q.currency)} (${q.status === "sent" ? "enviado" : "por aprobar"})`,
          ),
        ].join("\n"),
      };
    }
    case "pending_actions": {
      const list = await pendingActionsList(tx);
      if (!list.length) return { reply: "No hay acciones esperando aprobación." };
      return {
        reply: [
          "Acciones por aprobar:",
          ...list.map((a, i) => `${i + 1}. ${a.type} — ${quoteAsData(a.contactName, 60)} [${a.id.slice(0, 8)}]`),
          "Responde «/aprobar 1» o «/rechazar 1».",
        ].join("\n"),
      };
    }
    case "sales_week": {
      const paid = await paidSince(tx, new Date(now.getTime() - 7 * 24 * 3600 * 1000));
      return { reply: `Últimos 7 días: ${paid.count} pagos verificados — ${paid.byCurrency}` };
    }
    case "search_contact": {
      const q = (c.query ?? "").trim();
      if (q.length < 2) return { reply: "Dime el nombre o teléfono a buscar." };
      const like = `%${escapeLike(q)}%`;
      const rows = await tx
        .select({ name: contacts.name, phone: contacts.phoneE164 })
        .from(contacts)
        .where(or(ilike(contacts.name, like), ilike(contacts.phoneE164, like)))
        .orderBy(desc(contacts.updatedAt))
        .limit(5);
      if (!rows.length) return { reply: `Sin resultados para ${quoteAsData(q, 60)}.` };
      return { reply: ["Clientes:", ...rows.map((r) => `• ${quoteAsData(r.name, 60)} ${r.phone}`)].join("\n") };
    }
    case "approve_action":
    case "reject_action": {
      const target = await resolveActionRef(tx, c.actionRef);
      if (typeof target === "string") return { reply: target, error: true };
      const verb = c.intent === "approve_action" ? "Aprobar" : "Rechazar";
      return { pending: { intent: c.intent, payload: { actionId: target.id }, summary: `${verb} la acción ${target.type} [${target.id.slice(0, 8)}]` } };
    }
    case "pause_ai":
      return { pending: { intent: c.intent, payload: {}, summary: "Pausar la IA en todas las conversaciones" } };
    case "resume_ai":
      return { pending: { intent: c.intent, payload: {}, summary: "Reactivar la IA" } };
    case "draft_reply": {
      const name = (c.query ?? "").trim();
      const text = (c.replyText ?? "").trim();
      if (name.length < 2 || !text) return { reply: "Formato: «/responder Juan: mañana voy».", error: true };
      const like = `%${escapeLike(name)}%`;
      const found = await tx
        .select({ conversationId: conversations.id, lastInboundAt: conversations.lastInboundAt, name: contacts.name, phone: contacts.phoneE164 })
        .from(conversations)
        .innerJoin(contacts, eq(contacts.id, conversations.contactId))
        .where(and(ne(conversations.status, "resolved"), or(ilike(contacts.name, like), ilike(contacts.phoneE164, like))))
        .orderBy(desc(conversations.lastMessageAt))
        .limit(2);
      if (found.length !== 1 || !found[0]) {
        return { reply: found.length ? `Hay varios clientes que coinciden con ${quoteAsData(name, 60)}; sé más específico.` : `No hay conversación abierta con ${quoteAsData(name, 60)}.`, error: true };
      }
      const conv = found[0];
      if (!conv.lastInboundAt || now.getTime() - conv.lastInboundAt.getTime() >= WINDOW_24H_MS) {
        return { reply: "La ventana de 24 h de ese cliente está cerrada: responde desde la bandeja con una plantilla.", error: true };
      }
      return {
        pending: {
          intent: c.intent,
          payload: { conversationId: conv.conversationId, text: text.slice(0, 1000) },
          summary: `Enviar a ${quoteAsData(conv.name ?? conv.phone, 60)}:\n«${text.slice(0, 1000)}»`,
        },
      };
    }
  }
}

/** Runs a confirmed command (same transaction as the confirmation). Never touches payments. */
async function execute(tx: Transaction, pending: OwnerCommand, deps: OwnerModeDeps, after: AfterCommit, now: Date): Promise<string> {
  const intent = pending.intent as OwnerIntent;
  const p = pending.payload;
  switch (intent) {
    case "approve_action":
    case "reject_action": {
      const actionId = p["actionId"];
      if (!isUuid(actionId)) return "Acción no válida.";
      const decision = intent === "approve_action" ? "approved" : "rejected";
      const res = await decideAiActionAsUser(tx, { tenantId: pending.tenantId, actionId, userId: pending.userId, decision, source: OWNER_SOURCE });
      if (!res.ok) return res.reason === "not_found" ? "La acción ya no existe." : `La acción ya está ${res.status ?? "decidida"}.`;
      if (decision === "approved") {
        after.push(async () => {
          if (!deps.aiQueue) return;
          await deps.aiQueue.add(EXECUTE_AI_ACTION_JOB, { tenantId: pending.tenantId, actionId }, { ...AI_JOB_OPTIONS, jobId: `execute-${actionId}` });
        });
      }
      return decision === "approved" ? "Acción aprobada." : "Acción rechazada.";
    }
    case "pause_ai":
    case "resume_ai":
      await setTenantAiPaused(tx, pending.tenantId, intent === "pause_ai", pending.userId);
      return intent === "pause_ai" ? "IA pausada. Escribe /activar para reactivarla." : "IA reactivada.";
    case "draft_reply": {
      const conversationId = p["conversationId"];
      const text = p["text"];
      if (!isUuid(conversationId) || typeof text !== "string" || !text) return "Borrador no válido.";
      const [conv] = await tx
        .select({ id: conversations.id, lastInboundAt: conversations.lastInboundAt })
        .from(conversations)
        .where(and(eq(conversations.id, conversationId), ne(conversations.status, "resolved")))
        .limit(1);
      if (!conv) return "La conversación ya no está abierta.";
      if (!conv.lastInboundAt || now.getTime() - conv.lastInboundAt.getTime() >= WINDOW_24H_MS) return "La ventana de 24 h se cerró; no se envió.";
      const [msg] = await tx
        .insert(messages)
        .values({
          tenantId: pending.tenantId,
          conversationId,
          direction: "outbound",
          type: "text",
          body: text,
          status: "queued",
          author: "user",
          authorUserId: pending.userId,
        })
        .returning({ id: messages.id });
      if (!msg) throw new Error("message insert returned no row");
      await tx.update(conversations).set({ lastMessageAt: now, updatedAt: now }).where(eq(conversations.id, conversationId));
      await audit(tx, pending, "owner_mode.reply_sent", { conversationId, messageId: msg.id });
      after.push(async () => {
        if (!deps.outboundQueue) return;
        const data: SendMessageJobData = { tenantId: pending.tenantId, messageId: msg.id };
        await deps.outboundQueue.add(SEND_MESSAGE_JOB, data, { ...SEND_MESSAGE_JOB_OPTIONS, jobId: msg.id });
      });
      return "Mensaje enviado al cliente.";
    }
    default:
      return "Nada que confirmar.";
  }
}

/**
 * Handles one owner-mode message: re-checks the sender is still a verified owner/admin, rate
 * limits, then either answers a read-only query, parks a mutating command behind a confirmation
 * nonce, or executes a previously parked command when the matching nonce comes back.
 */
export async function processOwnerCommand(deps: OwnerModeDeps, data: unknown): Promise<OwnerCommandOutcome> {
  const { tenantId, commandId } = assertJob(data);
  const now = deps.now?.() ?? new Date();
  const log = deps.logger ?? silent;

  const [peek] = await withTenant(deps.db, tenantId, (tx) =>
    tx.select({ status: ownerCommands.status, body: ownerCommands.body }).from(ownerCommands).where(eq(ownerCommands.id, commandId)).limit(1),
  );
  if (!peek) return { outcome: "skipped", reason: "not_found" };
  if (peek.status !== "received") return { outcome: "skipped", reason: "already_handled" };

  // Interpretation happens outside the transaction (network call). Confirmations never hit the LLM.
  const body = peek.body ?? "";
  const replyParse = parseOwnerReply(body);
  let interpretation: OwnerCommandInterpretation | null = null;
  let limitReached = false;
  if (replyParse.kind === "other") {
    interpretation = parseOwnerShortcut(body);
    if (!interpretation && deps.interpret) {
      try {
        const r = await deps.interpret(tenantId, commandId, body);
        if (r.kind === "limit") limitReached = true;
        else if (r.kind === "ok") interpretation = r.value;
      } catch (err) {
        log.warn(`owner-mode interpreter failed (${err instanceof Error ? err.name : "unknown"})`);
      }
    }
    interpretation ??= { intent: "unknown", actionRef: null, query: null, replyText: null };
  }

  const after: AfterCommit = [];
  const out = await withTenant(deps.db, tenantId, async (tx) => {
    const [cmd] = await tx.select().from(ownerCommands).where(eq(ownerCommands.id, commandId)).for("update");
    if (!cmd || cmd.status !== "received") return { res: { outcome: "skipped", reason: "already_handled" } as OwnerCommandOutcome };
    const [phone] = await tx.select({ phone: ownerPhones.phoneE164 }).from(ownerPhones).where(eq(ownerPhones.id, cmd.ownerPhoneId)).limit(1);
    const owner = phone ? await findVerifiedOwner(tx, phone.phone) : null;
    const finish = async (status: OwnerCommand["status"], reply: string | null, intent: string, extra: Partial<OwnerCommand> = {}) => {
      await tx
        .update(ownerCommands)
        .set({ status, reply: reply ? reply.slice(0, 4000) : null, intent, decidedAt: now, ...extra })
        .where(eq(ownerCommands.id, cmd.id));
      await audit(tx, cmd, `owner_mode.${intent}`, { status });
    };

    if (!owner || owner.ownerPhoneId !== cmd.ownerPhoneId || owner.userId !== cmd.userId) {
      // Unlinked or demoted since ingest: silently drop (never answer an unverified number).
      await finish("rejected", null, "not_owner");
      return { res: { outcome: "rejected", reason: "not_owner" } as OwnerCommandOutcome };
    }
    const to = { channelConnectionId: cmd.channelConnectionId, toE164: phone?.phone ?? "" };

    const [recent] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(ownerCommands)
      .where(
        and(
          eq(ownerCommands.ownerPhoneId, cmd.ownerPhoneId),
          ne(ownerCommands.id, cmd.id),
          gt(ownerCommands.createdAt, new Date(now.getTime() - OWNER_MODE_LIMITS.rateWindowMs)),
        ),
      );
    if (isRateLimited(recent?.n ?? 0)) {
      const reply = "Demasiadas peticiones seguidas. Prueba en unos minutos.";
      await finish("rejected", reply, "rate_limited");
      return { res: { outcome: "rejected", reason: "rate_limited" } as OwnerCommandOutcome, reply, to };
    }

    // Expire stale confirmations of this phone first: they can never be confirmed afterwards.
    await tx
      .update(ownerCommands)
      .set({ status: "expired", nonceHash: null, decidedAt: now })
      .where(
        and(
          eq(ownerCommands.ownerPhoneId, cmd.ownerPhoneId),
          eq(ownerCommands.status, "awaiting_confirmation"),
          sql`${ownerCommands.expiresAt} <= ${now.toISOString()}::timestamptz`,
        ),
      );

    if (replyParse.kind === "confirm" || replyParse.kind === "confirm_without_nonce" || replyParse.kind === "cancel") {
      const open = await tx
        .select()
        .from(ownerCommands)
        .where(and(eq(ownerCommands.ownerPhoneId, cmd.ownerPhoneId), eq(ownerCommands.status, "awaiting_confirmation")))
        .orderBy(desc(ownerCommands.createdAt))
        .limit(LIST_LIMIT)
        .for("update");
      if (replyParse.kind === "cancel") {
        if (open.length) {
          await tx
            .update(ownerCommands)
            .set({ status: "cancelled", nonceHash: null, decidedAt: now })
            .where(inArray(ownerCommands.id, open.map((o) => o.id)));
        }
        const reply = open.length ? "Cancelado." : "No había nada pendiente de confirmar.";
        await finish("answered", reply, "cancel");
        return { res: { outcome: "answered", intent: "cancel" } as OwnerCommandOutcome, reply, to };
      }
      if (replyParse.kind === "confirm_without_nonce") {
        const reply = open.length ? "Para confirmar responde «sí» seguido del código de 6 dígitos." : "No hay nada pendiente de confirmar.";
        await finish("answered", reply, "confirm");
        return { res: { outcome: "answered", intent: "confirm" } as OwnerCommandOutcome, reply, to };
      }
      const nonce = replyParse.nonce;
      const target = open.find((o) => ownerSecretMatches(o.nonceHash, nonce, o.id));
      if (!target) {
        // Wrong, expired or already used nonce: nothing is executed.
        const reply = "Código no válido o caducado. No se ha hecho ningún cambio.";
        await finish("answered", reply, "confirm", { payload: { result: "invalid_nonce" } });
        return { res: { outcome: "confirmation_failed" } as OwnerCommandOutcome, reply, to };
      }
      // Consume the nonce before executing: a replay finds no awaiting row.
      await tx.update(ownerCommands).set({ status: "confirmed", nonceHash: null, decidedAt: now }).where(eq(ownerCommands.id, target.id));
      const reply = await execute(tx, target, deps, after, now);
      await audit(tx, target, `owner_mode.${target.intent ?? "unknown"}.confirmed`, { confirmedBy: cmd.id, result: reply });
      await finish("answered", reply, "confirm", { payload: { confirms: target.id } });
      return { res: { outcome: "confirmed", intent: target.intent as OwnerIntent, pendingId: target.id } as OwnerCommandOutcome, reply, to };
    }

    if (limitReached) {
      const reply = "Límite de IA alcanzado. Los atajos (/resumen, /ayuda…) siguen funcionando.";
      await finish("answered", reply, "ai_limit");
      return { res: { outcome: "answered", intent: "unknown" } as OwnerCommandOutcome, reply, to };
    }
    const c = interpretation as OwnerCommandInterpretation;
    const planned = await plan(tx, cmd, c, now);
    if ("pending" in planned && isMutatingIntent(c.intent)) {
      const nonce = newOwnerSecret();
      const expiresAt = new Date(now.getTime() + OWNER_MODE_LIMITS.nonceTtlMs);
      const reply = `${planned.pending.summary}\n\nPara confirmar responde «sí ${nonce}» (caduca en 5 min). «no» para cancelar.`;
      await finish("awaiting_confirmation", reply, c.intent, {
        payload: planned.pending.payload,
        nonceHash: hashOwnerSecret(nonce, cmd.id),
        expiresAt,
      });
      return { res: { outcome: "awaiting_confirmation", intent: c.intent } as OwnerCommandOutcome, reply, to };
    }
    const reply = "reply" in planned ? planned.reply : "Nada que hacer.";
    await finish("answered", reply, c.intent);
    return { res: { outcome: "answered", intent: c.intent } as OwnerCommandOutcome, reply, to };
  });

  for (const job of after) {
    try {
      await job();
    } catch (err) {
      log.warn(`owner-mode post-commit enqueue failed (${err instanceof Error ? err.name : "unknown"})`);
    }
  }
  if (out.reply && out.to?.toE164) {
    try {
      await deps.send({ tenantId, channelConnectionId: out.to.channelConnectionId, toE164: out.to.toE164, text: out.reply });
    } catch (err) {
      // The command is committed (and audited); the owner can ask again.
      log.warn(`owner-mode reply not sent (${err instanceof Error ? err.name : "unknown"})`);
    }
  }
  return out.res;
}
