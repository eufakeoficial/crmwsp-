import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDb } from "./client.js";

export const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), "../drizzle");

/** Applies pending migrations. Must be called with the migrator role URL. */
export async function runMigrations(url: string): Promise<void> {
  const { db, close } = createDb(url, { max: 1 });
  try {
    await migrate(db, { migrationsFolder });
  } finally {
    await close();
  }
}

const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const url = process.env.DATABASE_URL_MIGRATOR;
  if (!url) {
    console.error("db:migrate: DATABASE_URL_MIGRATOR is not set");
    process.exit(1);
  }
  runMigrations(url)
    .then(() => {
      console.log("db:migrate: migrations applied");
    })
    .catch((err: unknown) => {
      // Do not print the URL (it contains credentials).
      console.error("db:migrate: failed", err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
