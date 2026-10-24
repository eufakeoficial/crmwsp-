import { Inject, Injectable } from "@nestjs/common";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  type PlatformSupportListQuery,
  type PlatformSupportTicket,
  type SupportCannedResponse,
  type SupportMessage,
  type SupportTicketCategory,
  type SupportTicketPriority,
  type SupportTicketStatus,
} from "@crmwsp/contracts";
import { DB_HANDLE, type DbHandle } from "../common/http.js";
import { pgCode } from "../inbox/audit.js";

interface TicketRow {
  ticket_id: string;
  number: number;
  tenant_id: string;
  tenant_name: string;
  subject: string;
  category: SupportTicketCategory;
  priority: SupportTicketPriority;
  status: SupportTicketStatus;
  created_by: string | null;
  creator_name: string | null;
  creator_email: string | null;
  assignee_id: string | null;
  assignee_name: string | null;
  tenant_unread: boolean;
  admin_unread: boolean;
  last_message_at: Date;
  created_at: Date;
  resolved_at: Date | null;
}

const iso = (d: Date | string): string => new Date(d).toISOString();

function toTicket(r: TicketRow): PlatformSupportTicket {
  return {
    id: r.ticket_id,
    number: r.number,
    subject: r.subject,
    category: r.category,
    priority: r.priority,
    status: r.status,
    createdBy: { id: r.created_by, name: r.creator_name, email: r.creator_email },
    assignee: r.assignee_id ? { id: r.assignee_id, name: r.assignee_name } : null,
    unread: r.tenant_unread,
    adminUnread: r.admin_unread,
    tenant: { id: r.tenant_id, name: r.tenant_name },
    lastMessageAt: iso(r.last_message_at),
    createdAt: iso(r.created_at),
    resolvedAt: r.resolved_at ? iso(r.resolved_at) : null,
  };
}

/** Maps the definer functions' SQLSTATEs (no data in them) to API errors. */
async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    switch (pgCode(err)) {
      case "42501":
      case "P0002":
        throw new NotFoundError();
      case "22023":
      case "23514":
        throw new ValidationError("Invalid argument");
      case "55000":
        throw new ConflictError("Not allowed for the current status");
      default:
        throw err;
    }
  }
}

/**
 * Data path of the backoffice support inbox: only the `platform_support_*` SECURITY DEFINER
 * functions of migration 0068, which re-check `platform_admins` on every call.
 */
@Injectable()
export class PlatformSupportRepository {
  constructor(@Inject(DB_HANDLE) private readonly handle: DbHandle) {}

  private get sql() {
    return this.handle.sql;
  }

  list(actor: string, f: PlatformSupportListQuery & { ticketId?: string }): Promise<PlatformSupportTicket[]> {
    return guarded(async () => {
      const rows = await this.sql<TicketRow[]>`
        select * from public.platform_support_ticket_list(${actor}, ${f.status ?? null}, ${f.priority ?? null}, ${f.category ?? null},
          ${f.tenantId ?? null}, ${f.assigned ?? null}, ${f.ticketId ?? null})`;
      return rows.map(toTicket);
    });
  }

  async get(actor: string, ticketId: string): Promise<PlatformSupportTicket> {
    const [t] = await this.list(actor, { ticketId });
    if (!t) throw new NotFoundError();
    return t;
  }

  messages(actor: string, ticketId: string): Promise<SupportMessage[]> {
    return guarded(async () => {
      const rows = await this.sql<
        { message_id: string; author_type: SupportMessage["authorType"]; author_name: string | null; body: string; internal: boolean; created_at: Date }[]
      >`select * from public.platform_support_messages(${actor}, ${ticketId})`;
      return rows.map((m) => ({
        id: m.message_id,
        authorType: m.author_type,
        authorName: m.author_name,
        body: m.body,
        internal: m.internal,
        createdAt: iso(m.created_at),
      }));
    });
  }

  markRead(actor: string, ticketId: string): Promise<void> {
    return guarded(async () => {
      await this.sql`select public.platform_support_mark_read(${actor}, ${ticketId})`;
    });
  }

  /** Returns the ticket's tenant (to push the realtime event). */
  reply(actor: string, ticketId: string, body: string, internal: boolean, ip: string | null): Promise<string> {
    return guarded(async () => {
      const [r] = await this.sql<{ tenant_id: string }[]>`
        select tenant_id from public.platform_support_reply(${actor}, ${ticketId}, ${body}, ${internal}, ${ip})`;
      if (!r) throw new NotFoundError();
      return r.tenant_id;
    });
  }

  update(
    actor: string,
    ticketId: string,
    f: { status?: SupportTicketStatus | undefined; priority?: SupportTicketPriority | undefined; assign?: "me" | "none" | undefined },
    ip: string | null,
  ): Promise<string> {
    return guarded(async () => {
      const [r] = await this.sql<{ v: string }[]>`
        select public.platform_support_update(${actor}, ${ticketId}, ${f.status ?? null}, ${f.priority ?? null}, ${f.assign ?? null}, ${ip}) as v`;
      if (!r) throw new NotFoundError();
      return r.v;
    });
  }

  unreadCount(actor: string): Promise<number> {
    return guarded(async () => {
      const [r] = await this.sql<{ v: number }[]>`select public.platform_support_unread_count(${actor}) as v`;
      return r?.v ?? 0;
    });
  }

  cannedList(actor: string): Promise<SupportCannedResponse[]> {
    return guarded(async () => {
      const rows = await this.sql<CannedRow[]>`select * from public.platform_support_canned_list(${actor})`;
      return rows.map(toCanned);
    });
  }

  cannedUpsert(actor: string, id: string | null, title: string, body: string, ip: string | null): Promise<SupportCannedResponse> {
    return guarded(async () => {
      const [r] = await this.sql<CannedRow[]>`select * from public.platform_support_canned_upsert(${actor}, ${id}, ${title}, ${body}, ${ip})`;
      if (!r) throw new NotFoundError();
      return toCanned(r);
    });
  }

  cannedDelete(actor: string, id: string, ip: string | null): Promise<boolean> {
    return guarded(async () => {
      const [r] = await this.sql<{ v: boolean }[]>`select public.platform_support_canned_delete(${actor}, ${id}, ${ip}) as v`;
      return r?.v === true;
    });
  }
}

interface CannedRow {
  canned_id: string;
  title: string;
  body: string;
  updated_at: Date;
}
const toCanned = (r: CannedRow): SupportCannedResponse => ({ id: r.canned_id, title: r.title, body: r.body, updatedAt: iso(r.updated_at) });
