import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  ConflictError,
  type CreateInvitationRequest,
  ForbiddenError,
  type InvitableRole,
  type MembershipRole,
  NotFoundError,
  type TeamInvitation,
} from "@crmwsp/contracts";
import {
  canChangeRole,
  canInvite,
  canManageInvitation,
  canRemoveMember,
  INVITATION_TTL_MS,
  type TeamDecision,
} from "@crmwsp/domain";
import { and, asc, eq, isNull, memberships, sql, teamInvitations, tenants, users, type Transaction } from "@crmwsp/db";
import { PlanLimitsService } from "../billing/plan-limits.service.js";
import type { TenantDb } from "../db/tenant-db.js";
import { writeAudit } from "../inbox/audit.js";
import type { Mailer } from "@crmwsp/mailer";
import { invitationEmail, MAILER, newInvitationToken, publicWebUrl } from "./invitation-token.js";

export interface Actor {
  userId: string;
  role: MembershipRole;
  ip?: string | undefined;
}

function assertAllowed(d: TeamDecision): void {
  if (!d.allowed) throw new ForbiddenError("Not allowed for your role", { details: { reason: d.reason } });
}

const toDto = (r: typeof teamInvitations.$inferSelect): TeamInvitation => ({
  id: r.id,
  email: r.email,
  role: r.role as InvitableRole,
  invitedBy: r.invitedBy,
  expiresAt: r.expiresAt.toISOString(),
  lastSentAt: r.lastSentAt.toISOString(),
  createdAt: r.createdAt.toISOString(),
});

interface PendingMail {
  to: string;
  token: string;
  tenantName: string;
  role: string;
  inviterName: string | null;
}

@Injectable()
export class TeamService {
  private readonly logger = new Logger(TeamService.name);

  constructor(
    @Inject(PlanLimitsService) private readonly limits: PlanLimitsService,
    @Inject(MAILER) private readonly mailer: Mailer,
  ) {}

  listInvitations(db: TenantDb): Promise<TeamInvitation[]> {
    return db.run(async (tx) => {
      const rows = await tx
        .select()
        .from(teamInvitations)
        .where(and(isNull(teamInvitations.acceptedAt), isNull(teamInvitations.revokedAt)))
        .orderBy(asc(teamInvitations.createdAt), asc(teamInvitations.id));
      return rows.map(toDto);
    });
  }

  async invite(db: TenantDb, actor: Actor, input: CreateInvitationRequest): Promise<TeamInvitation> {
    assertAllowed(canInvite(actor.role, input.role));
    const email = input.email.toLowerCase();
    const { dto, mail } = await db.run(async (tx) => {
      await lockTeam(tx, db.tenantId);
      const member = await tx
        .select({ id: users.id })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(sql`lower(${users.email}) = ${email}`)
        .limit(1);
      if (member.length) throw new ConflictError("This email is already a member");
      const [pending] = await tx
        .select()
        .from(teamInvitations)
        .where(and(eq(teamInvitations.email, email), isNull(teamInvitations.acceptedAt), isNull(teamInvitations.revokedAt)))
        .limit(1);
      if (pending && pending.expiresAt.getTime() > Date.now()) throw new ConflictError("There is already a pending invitation for this email");
      // An expired pending invitation is superseded (it no longer holds a seat).
      if (pending) await tx.update(teamInvitations).set({ revokedAt: new Date() }).where(eq(teamInvitations.id, pending.id));
      await this.limits.assert(db.tenantId, "seats", 1, tx);
      const t = newInvitationToken();
      const [row] = await tx
        .insert(teamInvitations)
        .values({
          tenantId: db.tenantId,
          email,
          role: input.role,
          tokenHash: t.hash,
          invitedBy: actor.userId,
          expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
        })
        .returning();
      if (!row) throw new Error("invitation insert returned no row");
      await writeAudit(tx, {
        tenantId: db.tenantId,
        userId: actor.userId,
        entity: "team_invitation",
        entityId: row.id,
        action: "team_invitation.created",
        diff: { email, role: input.role },
        ip: actor.ip,
      });
      return { dto: toDto(row), mail: await mailContext(tx, actor.userId, { to: email, token: t.token, role: input.role }) };
    });
    await this.deliver(mail);
    return dto;
  }

  async resend(db: TenantDb, actor: Actor, id: string): Promise<TeamInvitation> {
    const { dto, mail } = await db.run(async (tx) => {
      await lockTeam(tx, db.tenantId);
      const row = await pendingById(tx, id);
      assertAllowed(canManageInvitation(actor.role, row.role));
      // Expired invitations did not hold a seat: re-reserve it.
      if (row.expiresAt.getTime() <= Date.now()) await this.limits.assert(db.tenantId, "seats", 1, tx);
      const t = newInvitationToken();
      const now = new Date();
      const [updated] = await tx
        .update(teamInvitations)
        .set({ tokenHash: t.hash, expiresAt: new Date(now.getTime() + INVITATION_TTL_MS), lastSentAt: now })
        .where(eq(teamInvitations.id, id))
        .returning();
      if (!updated) throw new NotFoundError("Invitation not found");
      await writeAudit(tx, {
        tenantId: db.tenantId,
        userId: actor.userId,
        entity: "team_invitation",
        entityId: id,
        action: "team_invitation.resent",
        ip: actor.ip,
      });
      return { dto: toDto(updated), mail: await mailContext(tx, actor.userId, { to: updated.email, token: t.token, role: updated.role }) };
    });
    await this.deliver(mail);
    return dto;
  }

  async revoke(db: TenantDb, actor: Actor, id: string): Promise<void> {
    await db.run(async (tx) => {
      const row = await pendingById(tx, id);
      assertAllowed(canManageInvitation(actor.role, row.role));
      await tx.update(teamInvitations).set({ revokedAt: new Date() }).where(eq(teamInvitations.id, id));
      await writeAudit(tx, {
        tenantId: db.tenantId,
        userId: actor.userId,
        entity: "team_invitation",
        entityId: id,
        action: "team_invitation.revoked",
        diff: { email: row.email, role: row.role },
        ip: actor.ip,
      });
    });
  }

  async changeRole(db: TenantDb, actor: Actor, userId: string, next: MembershipRole): Promise<void> {
    await db.run(async (tx) => {
      const { target, ownerCount } = await lockedMember(tx, userId);
      if (target.role === next) return;
      assertAllowed(canChangeRole({ actor: actor.role, current: target.role, next, ownerCount }));
      await tx.update(memberships).set({ role: next }).where(eq(memberships.id, target.id));
      await writeAudit(tx, {
        tenantId: db.tenantId,
        userId: actor.userId,
        entity: "membership",
        entityId: target.id,
        action: "membership.role_changed",
        diff: { userId, from: target.role, to: next },
        ip: actor.ip,
      });
    });
  }

  async removeMember(db: TenantDb, actor: Actor, userId: string): Promise<void> {
    await db.run(async (tx) => {
      const { target, ownerCount } = await lockedMember(tx, userId);
      assertAllowed(canRemoveMember({ actor: actor.role, target: target.role, ownerCount }));
      await tx.delete(memberships).where(eq(memberships.id, target.id));
      // Tenant access ends now (the tenant guard checks the membership per request); if this was
      // the user's last tenant, their sessions are revoked too.
      await tx.execute(sql`select public.revoke_sessions_if_orphaned(${userId}::uuid)`);
      await writeAudit(tx, {
        tenantId: db.tenantId,
        userId: actor.userId,
        entity: "membership",
        entityId: target.id,
        action: "membership.removed",
        diff: { userId, role: target.role },
        ip: actor.ip,
      });
    });
  }

  private async deliver(mail: PendingMail): Promise<void> {
    const link = `${publicWebUrl()}/invite/${mail.token}`;
    const { subject, text, html } = invitationEmail({ tenantName: mail.tenantName, role: mail.role, inviterName: mail.inviterName, link });
    try {
      await this.mailer.send({ to: mail.to, subject, text, html });
    } catch (err) {
      // The invitation stays valid and can be resent. Never log the link/token or the address.
      this.logger.warn(`invitation email failed: ${err instanceof Error ? err.message : "unknown error"}`);
    }
  }
}

/** Serializes team changes of one tenant (seat count, last-owner checks). */
async function lockTeam(tx: Transaction, tenantId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`team:${tenantId}`}, 0))`);
}

async function pendingById(tx: Transaction, id: string) {
  const [row] = await tx
    .select()
    .from(teamInvitations)
    .where(and(eq(teamInvitations.id, id), isNull(teamInvitations.acceptedAt), isNull(teamInvitations.revokedAt)))
    .limit(1);
  if (!row) throw new NotFoundError("Invitation not found");
  return row;
}

/** Locks every membership of the tenant (RLS-scoped) so owner counts cannot race. */
async function lockedMember(tx: Transaction, userId: string) {
  const rows = await tx.select({ id: memberships.id, userId: memberships.userId, role: memberships.role }).from(memberships).for("update");
  const target = rows.find((r) => r.userId === userId);
  if (!target) throw new NotFoundError("Member not found");
  return { target, ownerCount: rows.filter((r) => r.role === "owner").length };
}

async function mailContext(tx: Transaction, inviterId: string, m: { to: string; token: string; role: string }): Promise<PendingMail> {
  const [t] = await tx.select({ name: tenants.name }).from(tenants).limit(1);
  const [inviter] = await tx.select({ name: users.name }).from(users).where(eq(users.id, inviterId)).limit(1);
  return { ...m, tenantName: t?.name ?? "", inviterName: inviter?.name ?? null };
}
