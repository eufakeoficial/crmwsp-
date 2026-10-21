import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

const dialect = new PgDialect();

/** Renders a SQL fragment to text + params (tests and debugging; never executes). */
export function renderSql(fragment: SQL): { sql: string; params: unknown[] } {
  return dialect.sqlToQuery(fragment);
}
