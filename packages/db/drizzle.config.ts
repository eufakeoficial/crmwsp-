import { defineConfig } from "drizzle-kit";

// Migrations run with the migrator role (DDL rights), never the app role.
const url = process.env.DATABASE_URL_MIGRATOR;

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/*.ts",
  out: "./drizzle",
  ...(url ? { dbCredentials: { url } } : {}),
  strict: true,
  verbose: true,
});
