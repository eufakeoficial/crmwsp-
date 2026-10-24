import { Inject, Injectable } from "@nestjs/common";
import {
  NotFoundError,
  type SupportEmailAttachment,
  type SupportEmailFolder,
  type SupportEmailMessage,
  type SupportEmailThreadSummary,
  type SupportTicketPriority,
  type SupportTicketStatus,
} from "@crmwsp/contracts";
import { DB_HANDLE, type DbHandle } from "../common/http.js";
import { guarded } from "./platform-support.repository.js";

interface ListRow {
  ticket_id: string;
  number: number;
  subject: string;
  status: SupportTicketStatus;
  priority: SupportTicketPriority;
  contact_email: string | null;
  contact_name: string | null;
  tenant_id: string | null;
  tenant_name: string | null;
  assignee_id: string | null;
  assignee_name: string | null;
  snippet: string;
  admin_unread: boolean;
  last_message_at: Date;
}

interface MessageRow {
  message_id: string;
  author_type: "tenant_user" | "platform_admin" | "email_contact";
  author_name: string | null;
  from_email: string | null;
  to_emails: string[] | null;
  body: string;
  html: string | null;
  attachments: unknown;
  internal: boolean;
  auto_reason: string | null;
  email_message_id: string | null;
  created_at: Date;
}

/** Attachment metadata as stored by the worker (`emailId` = Resend received email id). */
export interface StoredAttachment extends SupportEmailAttachment {
  emailId: string;
}

export interface EmailMessageWithIds extends SupportEmailMessage {
  emailMessageId: string | null;
  storedAttachments: StoredAttachment[];
}

const iso = (d: Date | string): string => new Date(d).toISOString();

function toSummary(r: ListRow): SupportEmailThreadSummary {
  return {
    id: r.ticket_id,
    number: r.number,
    subject: r.subject,
    status: r.status,
    priority: r.priority,
    contactEmail: r.contact_email,
    contactName: r.contact_name,
    tenant: r.tenant_id ? { id: r.tenant_id, name: r.tenant_name ?? "" } : null,
    assignee: r.assignee_id ? { id: r.assignee_id, name: r.assignee_name } : null,
    snippet: r.snippet.replace(/\s+/g, " ").trim(),
    unread: r.admin_unread,
    lastMessageAt: iso(r.last_message_at),
  };
}

function storedAttachments(v: unknown): StoredAttachment[] {
  if (!Array.isArray(v)) return [];
  const out: StoredAttachment[] = [];
  for (const a of v) {
    if (!a || typeof a !== "object") continue;
    const o = a as Record<string, unknown>;
    if (typeof o.id !== "string" || typeof o.emailId !== "string") continue;
    out.push({
      id: o.id,
      emailId: o.emailId,
      filename: typeof o.filename === "string" ? o.filename : "adjunto",
      contentType: typeof o.contentType === "string" ? o.contentType : "application/octet-stream",
      size: typeof o.size === "number" ? o.size : null,
    });
  }
  return out;
}

function toMessage(r: MessageRow): EmailMessageWithIds {
  const stored = storedAttachments(r.attachments);
  return {
    id: r.message_id,
    direction: r.internal ? "note" : r.author_type === "platform_admin" ? "outbound" : "inbound",
    authorName: r.author_name,
    fromEmail: r.from_email,
    toEmails: r.to_emails ?? [],
    body: r.body,
    html: r.html,
    attachments: stored.map(({ emailId: _e, ...a }) => a),
    autoReason: r.auto_reason,
    createdAt: iso(r.created_at),
    emailMessageId: r.email_message_id,
    storedAttachments: stored,
  };
}

/** Data path of the platform email inbox: `platform_email_*` definer functions (0076). */
@Injectable()
export class PlatformEmailRepository {
  constructor(@Inject(DB_HANDLE) private readonly handle: DbHandle) {}

  private get sql() {
    return this.handle.sql;
  }

  list(actor: string, folder: SupportEmailFolder): Promise<SupportEmailThreadSummary[]> {
    return guarded(async () => {
      const rows = await this.sql<ListRow[]>`select * from public.platform_email_list(${actor}, ${folder})`;
      return rows.map(toSummary);
    });
  }

  get(actor: string, ticketId: string): Promise<SupportEmailThreadSummary> {
    return guarded(async () => {
      const [r] = await this.sql<ListRow[]>`select * from public.platform_email_list(${actor}, 'inbox', ${ticketId})`;
      if (!r) throw new NotFoundError();
      return toSummary(r);
    });
  }

  messages(actor: string, ticketId: string): Promise<EmailMessageWithIds[]> {
    return guarded(async () => {
      const rows = await this.sql<MessageRow[]>`select * from public.platform_email_messages(${actor}, ${ticketId})`;
      return rows.map(toMessage);
    });
  }

  unreadCount(actor: string): Promise<number> {
    return guarded(async () => {
      const [r] = await this.sql<{ v: number }[]>`select public.platform_email_unread_count(${actor}) as v`;
      return r?.v ?? 0;
    });
  }

  markRead(actor: string, ticketId: string): Promise<void> {
    return guarded(async () => {
      await this.sql`select public.platform_support_mark_read(${actor}, ${ticketId})`;
    });
  }

  recordOutbound(
    actor: string,
    ticketId: string | null,
    to: string,
    subject: string,
    body: string,
    messageId: string,
    ip: string | null,
  ): Promise<{ ticketId: string; tenantId: string | null }> {
    return guarded(async () => {
      const [r] = await this.sql<{ ticket_id: string; tenant_id: string | null }[]>`
        select ticket_id, tenant_id from public.platform_email_record_outbound(${actor}, ${ticketId}, ${to}, ${subject}, ${body}, ${messageId}, ${ip})`;
      if (!r) throw new NotFoundError();
      return { ticketId: r.ticket_id, tenantId: r.tenant_id };
    });
  }
}
