import type { Task } from "@crmwsp/contracts";
import { sql, type Transaction } from "@crmwsp/db";
import { iso } from "./util.js";

type SQL = ReturnType<typeof sql>;

interface TaskRow extends Record<string, unknown> {
  id: string;
  title: string;
  status: Task["status"];
  due_at: Date | string | null;
  opportunity_id: string | null;
  origin: "manual" | "ai" | "automation";
  user_id: string | null;
  user_name: string | null;
  contact_name: string | null;
}

const CREATED_BY: Record<TaskRow["origin"], Task["createdByType"]> = { manual: "user", ai: "ai", automation: "system" };

/** Tasks with assignee and contact name. Runs inside TenantDb.run (RLS scopes every table). */
export async function selectTasks(tx: Transaction, where: SQL[], limit = 200): Promise<Task[]> {
  const filter = where.length > 0 ? sql`where ${sql.join(where, sql` and `)}` : sql``;
  const rows = await tx.execute<TaskRow>(sql`
    select t.id, t.title, t.status, t.due_at, t.opportunity_id, t.origin,
           u.id as user_id, coalesce(u.name, u.email) as user_name,
           coalesce(c1.name, c2.name, c1.phone_e164, c2.phone_e164) as contact_name
    from tasks t
    left join users u on u.id = t.assigned_user_id
    left join opportunities o on o.tenant_id = t.tenant_id and o.id = t.opportunity_id
    left join contacts c1 on c1.tenant_id = o.tenant_id and c1.id = o.contact_id
    left join conversations cv on cv.tenant_id = t.tenant_id and cv.id = t.conversation_id
    left join contacts c2 on c2.tenant_id = cv.tenant_id and c2.id = cv.contact_id
    ${filter}
    order by t.due_at asc nulls last, t.created_at desc, t.id
    limit ${limit}
  `);
  return Array.from(rows).map((r) => ({
    id: r.id,
    title: r.title,
    status: r.status,
    dueAt: iso(r.due_at),
    assignedUser: r.user_id ? { id: r.user_id, name: r.user_name ?? "" } : null,
    opportunityId: r.opportunity_id,
    contactName: r.contact_name,
    createdByType: CREATED_BY[r.origin],
  }));
}
