import { randomUUID } from "node:crypto";
import {
  actionApprovals,
  aiActions,
  aiPauses,
  auditEvents,
  contacts,
  dangerouslyWithoutTenant,
  llmConnections,
  notifications,
  tenants,
  memberships,
  ownerCommands,
  ownerPhones,
  usageLedger,
  users,
  withTenant,
  type DbHandle,
} from "@crmwsp/db";
import { GupshupProvider } from "@crmwsp/whatsapp";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { processOwnerCommand, type OwnerModeDeps } from "../owner-mode/handler.js";
import { OWNER_COMMAND_JOB } from "../owner-mode/queue.js";
import { createOwnerInterpreter } from "../owner-mode/ports.js";
import { runNotificationTick } from "../notifications/index.js";
import type { CipherBox } from "@crmwsp/crypto";
import type { LLMProvider } from "@crmwsp/ai";
import { processIngestMessage, type ProcessorDeps } from "../processors.js";
import { APP_URL, MIGRATOR_URL, createDb, dropTenants, ingest, seedTenants, textPayload, type SeedTenant } from "./helpers.js";

const hasDb = Boolean(MIGRATOR_URL && APP_URL);

interface QueuedJob {
  name: string;
  data: unknown;
  opts: unknown;
}
const fakeQueue = (jobs: QueuedJob[]) => ({
  add: async (name: string, data: unknown, opts?: unknown) => {
    jobs.push({ name, data, opts });
    return {} as never;
  },
});

describe.skipIf(!hasDb)("owner mode (F9) inbound routing and commands", () => {
  let migrator: DbHandle;
  let app: DbHandle;
  let A: SeedTenant;
  let B: SeedTenant;
  const userIds: string[] = [];
  const suffix = randomUUID().slice(0, 8);
  // Gupshup sends digits without "+"; the provider normalises to E.164.
  const OWNER_A = "34611000001"; // verified owner of A
  const PENDING_A = "34611000002"; // registered in A but not verified
  const OWNER_B = "34611000003"; // verified owner of B only
  const ownerJobs: QueuedJob[] = [];
  const aiJobs: QueuedJob[] = [];
  const outJobs: QueuedJob[] = [];
  const sent: Array<{ tenantId: string; toE164: string; text: string }> = [];
  let ingestDeps: ProcessorDeps;
  let llmCalls = 0;
  const mockLlm = {
    name: "mock",
    chat: async (req: { messages: Array<{ content: string }> }) => {
      llmCalls++;
      const text = req.messages.at(-1)?.content ?? "";
      const intent = /vend/iu.test(text) ? "sales_week" : "unknown";
      return { content: "{}", parsed: { intent, actionRef: null, query: null, replyText: null }, usage: { inputTokens: 120, outputTokens: 30 }, model: "gpt-5-mini", finishReason: "stop" };
    },
  } as unknown as LLMProvider;
  let llmConnectionId = "";
  let ownerDeps: OwnerModeDeps;

  async function addOwner(tenantId: string, phone: string, status: "pending" | "verified", role: "owner" | "agent" = "owner"): Promise<string> {
    return dangerouslyWithoutTenant(migrator.db, async (tx) => {
      const [u] = await tx.insert(users).values({ email: `own-${phone}-${suffix}@example.test`, name: "Dueño" }).returning({ id: users.id });
      if (!u) throw new Error("seed failed");
      userIds.push(u.id);
      const [m] = await tx.insert(memberships).values({ tenantId, userId: u.id, role }).returning({ id: memberships.id });
      if (!m) throw new Error("seed failed");
      await tx.insert(ownerPhones).values({
        tenantId,
        membershipId: m.id,
        userId: u.id,
        phoneE164: `+${phone}`,
        status,
        verifiedAt: status === "verified" ? new Date() : null,
      });
      return u.id;
    });
  }

  async function send(t: SeedTenant, phone: string, text: string) {
    const extId = `wamid-${randomUUID()}`;
    const eventId = await ingest(app, t.token, `msg:${extId}`, textPayload(extId, phone, text, "Alguien"));
    return processIngestMessage(ingestDeps, { eventId, tenantId: t.tenantId });
  }

  /** Ingests an owner message and runs its owner-mode job; returns the outcome and the reply. */
  async function ownerSays(t: SeedTenant, phone: string, text: string) {
    const res = await send(t, phone, text);
    if (!res.ownerCommandId) throw new Error("not routed to owner mode");
    const before = sent.length;
    const outcome = await processOwnerCommand(ownerDeps, { tenantId: t.tenantId, commandId: res.ownerCommandId });
    return { outcome, reply: sent.slice(before).map((s) => s.text).join("\n"), commandId: res.ownerCommandId };
  }

  const nonceOf = (reply: string): string => {
    const m = /«sí (\d{6})»/u.exec(reply);
    if (!m?.[1]) throw new Error(`no nonce in reply: ${reply}`);
    return m[1];
  };

  beforeAll(async () => {
    migrator = createDb(MIGRATOR_URL as string, { max: 2 });
    app = createDb(APP_URL as string, { max: 6 });
    [A, B] = (await seedTenants(migrator, 2)) as [SeedTenant, SeedTenant];
    await addOwner(A.tenantId, OWNER_A, "verified");
    await addOwner(A.tenantId, PENDING_A, "pending");
    await addOwner(B.tenantId, OWNER_B, "verified");
    const [llm] = await dangerouslyWithoutTenant(migrator.db, (tx) =>
      tx
        .insert(llmConnections)
        .values({
          tenantId: A.tenantId,
          provider: "openai",
          baseUrl: "https://api.openai.com/v1",
          apiKeyEncrypted: Buffer.from("ciphertext"),
          modelCheap: "gpt-5-mini",
          isActive: true,
          lastTestOk: true,
        })
        .returning({ id: llmConnections.id }),
    );
    llmConnectionId = llm?.id ?? "";
    ingestDeps = {
      db: app.db,
      provider: new GupshupProvider(),
      publisher: { publish: async () => 0 },
      ownerQueue: fakeQueue(ownerJobs),
    };
    ownerDeps = {
      db: app.db,
      send: async (m) => {
        sent.push({ tenantId: m.tenantId, toE164: m.toE164, text: m.text });
      },
      // Mock LLM: natural language is classified by this stub (Structured Outputs contract shape).
      // Real interpreter (spend gates + ledger) over a mocked LLM provider; the key "decrypts" to a stub.
      interpret: createOwnerInterpreter({
        db: app.db,
        cipher: { decrypt: () => "sk-test" } as unknown as CipherBox,
        buildProvider: () => mockLlm,
      }),
      aiQueue: fakeQueue(aiJobs),
      outboundQueue: fakeQueue(outJobs),
    };
  });

  afterAll(async () => {
    if (migrator) {
      await dropTenants(migrator, [A?.tenantId, B?.tenantId].filter((x): x is string => Boolean(x)));
      if (userIds.length) await migrator.db.delete(users).where(inArray(users.id, userIds));
      await migrator.close();
    }
    await app?.close();
  });

  it("a non-owner phone goes through the normal customer pipeline", async () => {
    const res = await send(A, "34699000001", "Hola, precio?");
    expect(res.ownerCommandId).toBeUndefined();
    expect(res.conversationId).not.toBe("");
    const c = await withTenant(app.db, A.tenantId, (tx) => tx.select().from(contacts).where(eq(contacts.phoneE164, "+34699000001")));
    expect(c).toHaveLength(1);
  });

  it("an unverified owner phone is ignored by owner mode (treated as a customer)", async () => {
    const res = await send(A, PENDING_A, "/resumen");
    expect(res.ownerCommandId).toBeUndefined();
    const cmds = await withTenant(app.db, A.tenantId, (tx) => tx.select().from(ownerCommands).where(eq(ownerCommands.body, "/resumen")));
    expect(cmds).toHaveLength(0);
  });

  it("a phone verified only in another tenant is not an owner here (cross-tenant)", async () => {
    const res = await send(A, OWNER_B, "/resumen");
    expect(res.ownerCommandId).toBeUndefined();
    const c = await withTenant(app.db, A.tenantId, (tx) => tx.select().from(contacts).where(eq(contacts.phoneE164, `+${OWNER_B}`)));
    expect(c).toHaveLength(1);
  });

  it("a verified owner message creates no contact and is answered by owner mode", async () => {
    const jobsBefore = ownerJobs.length;
    const { outcome, reply } = await ownerSays(A, OWNER_A, "/resumen");
    expect(outcome).toEqual({ outcome: "answered", intent: "daily_summary" });
    expect(reply).toContain("Resumen de hoy");
    expect(ownerJobs.length).toBe(jobsBefore + 1);
    expect(ownerJobs.at(-1)?.name).toBe(OWNER_COMMAND_JOB);
    expect(sent.at(-1)?.toE164).toBe(`+${OWNER_A}`);
    const c = await withTenant(app.db, A.tenantId, (tx) => tx.select().from(contacts).where(eq(contacts.phoneE164, `+${OWNER_A}`)));
    expect(c).toHaveLength(0);
  });

  it("natural language goes through the (mocked) tenant LLM and is metered", async () => {
    const calls = llmCalls;
    const { outcome, reply, commandId } = await ownerSays(A, OWNER_A, "¿cuánto vendí esta semana?");
    expect(outcome).toEqual({ outcome: "answered", intent: "sales_week" });
    expect(reply).toContain("Últimos 7 días");
    expect(llmCalls).toBe(calls + 1);
    const ledger = await withTenant(app.db, A.tenantId, (tx) =>
      tx.select().from(usageLedger).where(and(eq(usageLedger.refType, "owner_command"), eq(usageLedger.refId, commandId))),
    );
    expect(ledger).toHaveLength(1);
    expect(ledger[0]?.kind).toBe("llm_tokens");
  });

  it("over the monthly budget the LLM is not called; shortcuts still work", async () => {
    await dangerouslyWithoutTenant(migrator.db, (tx) =>
      tx.update(llmConnections).set({ monthlyBudgetMinor: 0n, budgetCurrency: "USD" }).where(eq(llmConnections.id, llmConnectionId)),
    );
    const calls = llmCalls;
    const limited = await ownerSays(A, OWNER_A, "¿cuánto vendí hoy?");
    expect(limited.reply).toContain("Límite de IA alcanzado");
    expect(llmCalls).toBe(calls);
    const shortcut = await ownerSays(A, OWNER_A, "/ventas");
    expect(shortcut.outcome).toEqual({ outcome: "answered", intent: "sales_week" });
    await dangerouslyWithoutTenant(migrator.db, (tx) =>
      tx.update(llmConnections).set({ monthlyBudgetMinor: null, budgetCurrency: null }).where(eq(llmConnections.id, llmConnectionId)),
    );
  });

  it("a mutating command without confirmation does nothing", async () => {
    const { outcome, reply } = await ownerSays(A, OWNER_A, "/pausar");
    expect(outcome).toEqual({ outcome: "awaiting_confirmation", intent: "pause_ai" });
    expect(reply).toMatch(/«sí \d{6}»/u);
    const pauses = await withTenant(app.db, A.tenantId, (tx) => tx.select().from(aiPauses));
    expect(pauses.filter((p) => p.pausedAt)).toHaveLength(0);
    // A bare "sí" is not enough either.
    const bare = await ownerSays(A, OWNER_A, "sí");
    expect(bare.outcome).toEqual({ outcome: "answered", intent: "confirm" });
    const still = await withTenant(app.db, A.tenantId, (tx) => tx.select().from(aiPauses));
    expect(still.filter((p) => p.pausedAt)).toHaveLength(0);
    await ownerSays(A, OWNER_A, "no");
  });

  it("confirms with the nonce once; a replayed or wrong nonce is rejected", async () => {
    const asked = await ownerSays(A, OWNER_A, "/pausar");
    const nonce = nonceOf(asked.reply);
    const wrong = await ownerSays(A, OWNER_A, `sí ${nonce === "000000" ? "111111" : "000000"}`);
    expect(wrong.outcome).toEqual({ outcome: "confirmation_failed" });

    const ok = await ownerSays(A, OWNER_A, `sí ${nonce}`);
    expect(ok.outcome).toMatchObject({ outcome: "confirmed", intent: "pause_ai" });
    const [pause] = await withTenant(app.db, A.tenantId, (tx) => tx.select().from(aiPauses));
    expect(pause?.pausedAt).toBeInstanceOf(Date);

    const replay = await ownerSays(A, OWNER_A, `sí ${nonce}`);
    expect(replay.outcome).toEqual({ outcome: "confirmation_failed" });

    // AI is paused: a customer message schedules no AI turn (no aiQueue add even with a queue).
    const audit = await withTenant(app.db, A.tenantId, (tx) =>
      tx.select().from(auditEvents).where(and(eq(auditEvents.entity, "owner_command"), eq(auditEvents.action, "owner_mode.pause_ai.confirmed"))),
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]?.diff["source"]).toBe("owner_whatsapp");
    expect(audit[0]?.actorType).toBe("user");
  });

  it("approves a pending AI action through the shared approval rules, as that user", async () => {
    const [action] = await withTenant(app.db, A.tenantId, (tx) =>
      tx
        .insert(aiActions)
        .values({ tenantId: A.tenantId, type: "apply_discount", payload: { percent: 15 }, decision: "approve", status: "pending_approval" })
        .returning({ id: aiActions.id }),
    );
    if (!action) throw new Error("seed failed");
    const list = await ownerSays(A, OWNER_A, "/pendientes");
    expect(list.reply).toContain(action.id.slice(0, 8));
    const asked = await ownerSays(A, OWNER_A, `/aprobar ${action.id.slice(0, 8)}`);
    expect(asked.outcome).toEqual({ outcome: "awaiting_confirmation", intent: "approve_action" });
    const before = await withTenant(app.db, A.tenantId, (tx) => tx.select().from(aiActions).where(eq(aiActions.id, action.id)));
    expect(before[0]?.status).toBe("pending_approval");

    const ok = await ownerSays(A, OWNER_A, `Confirmo ${nonceOf(asked.reply)}`);
    expect(ok.outcome).toMatchObject({ outcome: "confirmed", intent: "approve_action" });
    const after = await withTenant(app.db, A.tenantId, async (tx) => ({
      action: (await tx.select().from(aiActions).where(eq(aiActions.id, action.id)))[0],
      approvals: await tx.select().from(actionApprovals).where(eq(actionApprovals.actionId, action.id)),
      audit: await tx.select().from(auditEvents).where(and(eq(auditEvents.entityId, action.id), eq(auditEvents.action, "ai_action.approved"))),
    }));
    expect(after.action?.status).toBe("approved");
    expect(after.approvals).toHaveLength(1);
    expect(after.audit[0]?.diff["source"]).toBe("owner_whatsapp");
    expect(after.audit[0]?.actorId).toBe(after.approvals[0]?.decidedBy);
    expect(aiJobs.at(-1)).toMatchObject({ data: { tenantId: A.tenantId, actionId: action.id } });
  });

  it("T7 notifications reach the verified owner phone directly; window closed falls back to email", async () => {
    await dangerouslyWithoutTenant(migrator.db, async (tx) => {
      await tx.update(tenants).set({ settings: { notifications: { ownerPhoneE164: `+${OWNER_A}` } } }).where(eq(tenants.id, A.tenantId));
      await tx.insert(notifications).values({ tenantId: A.tenantId, kind: "order_paid", title: "Pedido pagado", dedupeKey: `t7-a-${suffix}` });
    });
    const direct: Array<{ toE164: string; text: string; channelConnectionId: string }> = [];
    const emails: Array<{ to: string | null }> = [];
    const tickDeps = {
      db: app.db,
      publisher: { publish: async () => 0 },
      outboundQueue: fakeQueue(outJobs),
      sendOwnerText: async (m: { toE164: string; text: string; channelConnectionId: string }) => {
        direct.push(m);
      },
      sendOwnerEmail: async (m: { to: string | null }) => {
        emails.push(m);
      },
    };
    const outBefore = outJobs.length;
    await runNotificationTick(tickDeps);
    expect(direct).toEqual([expect.objectContaining({ toE164: `+${OWNER_A}`, text: "Pedido pagado", channelConnectionId: A.connectionId })]);
    expect(outJobs.length).toBe(outBefore);
    const c = await withTenant(app.db, A.tenantId, (tx) => tx.select().from(contacts).where(eq(contacts.phoneE164, `+${OWNER_A}`)));
    expect(c).toHaveLength(0);

    // 25 h later the owner has not written: no WhatsApp, email fallback instead.
    await dangerouslyWithoutTenant(migrator.db, (tx) =>
      tx.insert(notifications).values({ tenantId: A.tenantId, kind: "order_paid", title: "Otro pago", dedupeKey: `t7-b-${suffix}` }),
    );
    await runNotificationTick({ ...tickDeps, now: () => new Date(Date.now() + 25 * 3600_000) });
    expect(direct).toHaveLength(1);
    expect(emails).toHaveLength(1);
    expect(emails[0]?.to).toContain("@example.test");
  });

  it("a demoted member loses owner mode even with a verified phone", async () => {
    await dangerouslyWithoutTenant(migrator.db, (tx) =>
      tx
        .update(memberships)
        .set({ role: "agent" })
        .where(inArray(memberships.userId, tx.select({ id: ownerPhones.userId }).from(ownerPhones).where(eq(ownerPhones.phoneE164, `+${OWNER_B}`)))),
    );
    const res = await send(B, OWNER_B, "/resumen");
    expect(res.ownerCommandId).toBeUndefined();
  });
});
