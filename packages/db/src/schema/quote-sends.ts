import { sql } from "drizzle-orm";
import { foreignKey, pgTable, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { messages } from "./messages.js";
import { quotes } from "./quotes.js";
import { tenants } from "./tenants.js";
import { users } from "./users.js";

export const quoteSends = pgTable(
  "quote_sends",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    quoteId: uuid("quote_id").notNull(),
    messageId: uuid("message_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("quote_sends_tenant_id_id_idx").on(t.tenantId, t.id),
    uniqueIndex("quote_sends_tenant_quote_unique").on(t.tenantId, t.quoteId),
    foreignKey({
      name: "quote_sends_tenant_quote_fk",
      columns: [t.tenantId, t.quoteId],
      foreignColumns: [quotes.tenantId, quotes.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "quote_sends_tenant_message_fk",
      columns: [t.tenantId, t.messageId],
      foreignColumns: [messages.tenantId, messages.id],
    }).onDelete("cascade"),
  ],
);

export const quoteUnansweredReviews = pgTable(
  "quote_unanswered_reviews",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    quoteId: uuid("quote_id").notNull(),
    messageId: uuid("message_id").notNull(),
    reviewedBy: uuid("reviewed_by").references(() => users.id, { onDelete: "set null" }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("quote_unanswered_reviews_tenant_id_id_idx").on(t.tenantId, t.id),
    uniqueIndex("quote_unanswered_reviews_case_unique").on(t.tenantId, t.quoteId, t.messageId),
    foreignKey({
      name: "quote_unanswered_reviews_tenant_quote_fk",
      columns: [t.tenantId, t.quoteId],
      foreignColumns: [quotes.tenantId, quotes.id],
    }).onDelete("cascade"),
  ],
);

export type QuoteSend = typeof quoteSends.$inferSelect;
export type NewQuoteSend = typeof quoteSends.$inferInsert;
export type QuoteUnansweredReview = typeof quoteUnansweredReviews.$inferSelect;
export type NewQuoteUnansweredReview = typeof quoteUnansweredReviews.$inferInsert;
