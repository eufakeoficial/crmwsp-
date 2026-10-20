import { pgEnum } from "drizzle-orm/pg-core";

/**
 * Shared by quotes and orders. Lives in its own module so `quotes.ts` and `commerce.ts`
 * can reference each other's tables (lazily, in FKs) without an init-order cycle.
 */
export const quoteCreatedByType = pgEnum("quote_created_by_type", ["user", "ai"]);
