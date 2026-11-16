import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import type { Pool, PoolClient } from "pg";

async function applyMigration(
  client: PoolClient,
  directory: string,
  filename: string,
): Promise<void> {
  const sql = await readFile(path.join(directory, filename), "utf8");
  await client.query("BEGIN");
  try {
    await client.query(sql);
    await client.query(
      "INSERT INTO application_migrations (filename) VALUES ($1)",
      [filename],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

export async function runMigrations(
  pool: Pool,
  directory: string,
  lockName: string,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtext($1))", [lockName]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS application_migrations (
        filename text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const appliedResult = await client.query<{ filename: string }>(
      "SELECT filename FROM application_migrations",
    );
    const applied = new Set(appliedResult.rows.map(({ filename }) => filename));
    const filenames = (await readdir(directory))
      .filter((filename) => /^\d+_.+\.sql$/.test(filename))
      .sort();

    for (const filename of filenames) {
      if (!applied.has(filename)) {
        await applyMigration(client, directory, filename);
      }
    }
  } finally {
    await client
      .query("SELECT pg_advisory_unlock(hashtext($1))", [lockName])
      .catch(() => undefined);
    client.release();
  }
}
