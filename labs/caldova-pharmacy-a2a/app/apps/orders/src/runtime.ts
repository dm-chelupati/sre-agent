import { fileURLToPath } from "node:url";

import { runMigrations } from "@caldova/platform";
import { Pool } from "pg";

import { loadConfig } from "./config.js";

export async function createOrdersPool(): Promise<Pool> {
  const config = loadConfig();
  const pool = new Pool({
    connectionString: config.databaseUrl,
    max: config.databasePoolSize,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
  });
  const migrationsDirectory = fileURLToPath(
    new URL("../migrations", import.meta.url),
  );
  await runMigrations(
    pool,
    migrationsDirectory,
    "caldova-orders-migrations",
  );
  return pool;
}
