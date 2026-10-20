import { Body, Controller, Delete, Get, HttpCode, Inject, Post, Req, UseGuards } from "@nestjs/common";
import {
  ConflictError,
  NotFoundError,
  RateLimitedError,
  ValidationError,
  registerOwnerPhoneRequestSchema,
  verifyOwnerPhoneRequestSchema,
  type OwnerModeStatus,
} from "@crmwsp/contracts";
import {
  and,
  channelConnections,
  eq,
  hashOwnerSecret,
  isTenantAiPaused,
  memberships,
  ne,
  newOwnerSalt,
  newOwnerSecret,
  ownerPhones,
  ownerSecretMatches,
  type OwnerPhone,
  type Transaction,
} from "@crmwsp/db";
import { OWNER_MODE_LIMITS, canUseOwnerMode, checkOwnerCode } from "@crmwsp/domain";
import { CurrentTenantDb, Roles } from "../auth/decorators.js";
import { TenantGuard } from "../auth/tenant.guard.js";
import type { HttpRequest } from "../common/http.js";
import { parseOrThrow } from "../common/zod.js";
import type { TenantDb } from "../db/tenant-db.js";
import { writeAudit } from "../inbox/audit.js";
import { OWNER_CODE_SENDER, type OwnerCodeSender } from "./owner-mode.constants.js";

/** A new code can be requested at most once per minute. */
const RESEND_COOLDOWN_MS = 60_000;

function toDto(p: OwnerPhone | undefined): OwnerModeStatus["phone"] {
  if (!p) return null;
  return {
    id: p.id,
    userId: p.userId,
    phoneE164: p.phoneE164,
    status: p.status,
    verifiedAt: p.verifiedAt?.toISOString() ?? null,
    codeExpiresAt: p.status === "pending" ? (p.codeExpiresAt?.toISOString() ?? null) : null,
    attemptsLeft: Math.max(0, OWNER_MODE_LIMITS.maxCodeAttempts - p.attempts),
  };
}

async function myMembership(tx: Transaction, userId: string): Promise<{ id: string; role: string }> {
  const [m] = await tx.select({ id: memberships.id, role: memberships.role }).from(memberships).where(eq(memberships.userId, userId)).limit(1);
  if (!m || !canUseOwnerMode(m.role)) throw new NotFoundError();
  return m;
}

/**
 * F9 "modo dueño": an owner/admin links their own WhatsApp number. A 6-digit code is sent to it
 * through the tenant's active channel; only after verification do messages from that number go
 * to the owner-mode handler instead of the customer pipeline.
 */
@Controller("owner-mode")
@UseGuards(TenantGuard)
export class OwnerModeController {
  constructor(@Inject(OWNER_CODE_SENDER) private readonly sendCode: OwnerCodeSender) {}

  @Get()
  @Roles("owner", "admin")
  async status(@CurrentTenantDb() db: TenantDb): Promise<OwnerModeStatus> {
    return db.run(async (tx) => {
      const [p] = await tx.select().from(ownerPhones).where(eq(ownerPhones.userId, db.userId)).limit(1);
      return { phone: toDto(p), aiPaused: await isTenantAiPaused(tx) };
    });
  }

  @Post("phone")
  @Roles("owner", "admin")
  @HttpCode(200)
  async register(@CurrentTenantDb() db: TenantDb, @Body() body: unknown, @Req() req: HttpRequest): Promise<OwnerModeStatus> {
    const { phoneE164 } = parseOrThrow(registerOwnerPhoneRequestSchema, body);
    const code = newOwnerSecret();
    const now = new Date();
    const { row, channelId } = await db.run(async (tx) => {
      const m = await myMembership(tx, db.userId);
      const [taken] = await tx
        .select({ id: ownerPhones.id })
        .from(ownerPhones)
        .where(and(eq(ownerPhones.phoneE164, phoneE164), ne(ownerPhones.membershipId, m.id)))
        .limit(1);
      if (taken) throw new ConflictError("Phone already linked to another member");
      const [channel] = await tx
        .select({ id: channelConnections.id, phone: channelConnections.phoneE164 })
        .from(channelConnections)
        .where(eq(channelConnections.status, "active"))
        .limit(1);
      if (!channel) throw new ValidationError("No active WhatsApp channel to send the code");
      if (channel.phone === phoneE164) throw new ValidationError("The owner phone cannot be the business channel number");
      const [current] = await tx.select().from(ownerPhones).where(eq(ownerPhones.membershipId, m.id)).limit(1).for("update");
      if (current?.codeExpiresAt && current.codeExpiresAt.getTime() - OWNER_MODE_LIMITS.codeTtlMs + RESEND_COOLDOWN_MS > now.getTime()) {
        throw new RateLimitedError("Wait a minute before requesting a new code");
      }
      const salt = newOwnerSalt();
      const values = {
        phoneE164,
        status: "pending" as const,
        codeHash: hashOwnerSecret(code, salt),
        codeSalt: salt,
        codeExpiresAt: new Date(now.getTime() + OWNER_MODE_LIMITS.codeTtlMs),
        attempts: 0,
        verifiedAt: null,
        updatedAt: now,
      };
      const [saved] = current
        ? await tx.update(ownerPhones).set(values).where(eq(ownerPhones.id, current.id)).returning()
        : await tx.insert(ownerPhones).values({ tenantId: db.tenantId, membershipId: m.id, userId: db.userId, ...values }).returning();
      if (!saved) throw new Error("owner phone upsert returned no row");
      await writeAudit(tx, {
        tenantId: db.tenantId,
        userId: db.userId,
        entity: "owner_phone",
        entityId: saved.id,
        action: "owner_phone.code_sent",
        diff: { phoneE164, source: "web" },
        ip: req.ip,
      });
      return { row: saved, channelId: channel.id };
    });
    // Sent after commit; the code itself is never stored nor logged.
    await this.sendCode({ db, channelConnectionId: channelId, toE164: phoneE164, code });
    return db.run(async (tx) => ({ phone: toDto(row), aiPaused: await isTenantAiPaused(tx) }));
  }

  @Post("phone/verify")
  @Roles("owner", "admin")
  @HttpCode(200)
  async verify(@CurrentTenantDb() db: TenantDb, @Body() body: unknown, @Req() req: HttpRequest): Promise<OwnerModeStatus> {
    const { code } = parseOrThrow(verifyOwnerPhoneRequestSchema, body);
    const now = new Date();
    const result = await db.run(async (tx) => {
      const m = await myMembership(tx, db.userId);
      const [p] = await tx.select().from(ownerPhones).where(eq(ownerPhones.membershipId, m.id)).limit(1).for("update");
      if (!p || p.status !== "pending") throw new NotFoundError();
      const check = checkOwnerCode(p, ownerSecretMatches(p.codeHash, code, p.codeSalt ?? ""), now);
      if (check === "ok") {
        const [saved] = await tx
          .update(ownerPhones)
          .set({ status: "verified", verifiedAt: now, codeHash: null, codeSalt: null, codeExpiresAt: null, attempts: 0, updatedAt: now })
          .where(eq(ownerPhones.id, p.id))
          .returning();
        await writeAudit(tx, { tenantId: db.tenantId, userId: db.userId, entity: "owner_phone", entityId: p.id, action: "owner_phone.verified", diff: { phoneE164: p.phoneE164 }, ip: req.ip });
        return { check, row: saved };
      }
      // Every failed attempt counts; at the limit the code is burned and a new one must be requested.
      const attempts = p.attempts + 1;
      const burn = check !== "wrong" || attempts >= OWNER_MODE_LIMITS.maxCodeAttempts;
      const [saved] = await tx
        .update(ownerPhones)
        .set({ attempts, updatedAt: now, ...(burn ? { codeHash: null, codeSalt: null } : {}) })
        .where(eq(ownerPhones.id, p.id))
        .returning();
      await writeAudit(tx, { tenantId: db.tenantId, userId: db.userId, entity: "owner_phone", entityId: p.id, action: "owner_phone.verify_failed", diff: { reason: check, attempts }, ip: req.ip });
      return { check, row: saved };
    });
    if (result.check !== "ok") {
      if (result.check === "wrong") throw new ValidationError("Invalid code");
      if (result.check === "locked") throw new RateLimitedError("Too many attempts; request a new code");
      throw new ValidationError("Code expired; request a new one");
    }
    return db.run(async (tx) => ({ phone: toDto(result.row), aiPaused: await isTenantAiPaused(tx) }));
  }

  /** Unlinks the number: it stops routing at once. The row is kept (it anchors the command audit trail). */
  @Delete("phone")
  @Roles("owner", "admin")
  @HttpCode(200)
  async unlink(@CurrentTenantDb() db: TenantDb, @Req() req: HttpRequest): Promise<OwnerModeStatus> {
    return db.run(async (tx) => {
      const [p] = await tx
        .update(ownerPhones)
        .set({ status: "pending", verifiedAt: null, codeHash: null, codeSalt: null, codeExpiresAt: null, attempts: 0, updatedAt: new Date() })
        .where(eq(ownerPhones.userId, db.userId))
        .returning({ id: ownerPhones.id, phoneE164: ownerPhones.phoneE164 });
      if (p) {
        await writeAudit(tx, { tenantId: db.tenantId, userId: db.userId, entity: "owner_phone", entityId: p.id, action: "owner_phone.unlinked", diff: { phoneE164: p.phoneE164 }, ip: req.ip });
      }
      return { phone: null, aiPaused: await isTenantAiPaused(tx) };
    });
  }
}
