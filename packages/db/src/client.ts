import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index";

export type Schema = typeof schema;
export type Database = PostgresJsDatabase<Schema>;
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export interface DbHandle {
  db: Database;
  sql: postgres.Sql;
  close: () => Promise<void>;
}

export interface CreateDbOptions {
  /** Max pool size (postgres.js default: 10). */
  max?: number;
}

/**
 * Creates a Drizzle client over postgres.js. Runtime code must use the app
 * role URL (DATABASE_URL) and access data only through withTenant().
 */
export function createDb(url: string, options: CreateDbOptions = {}): DbHandle {
  if (!url) {
    throw new Error("createDb: database url is required");
  }
  const sql = postgres(url, {
    ...(options.max !== undefined ? { max: options.max } : {}),
    onnotice: () => {},
  });
  const db = drizzle(sql, { schema });
  return {
    db,
    sql,
    close: () => sql.end({ timeout: 5 }),
  };
}
