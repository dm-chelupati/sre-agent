import { logger } from "@caldova/platform";
import { shutdownTelemetry } from "@caldova/platform/telemetry";

import { createOrdersApp } from "./app.js";
import { loadConfig } from "./config.js";
import { PostgresOrderRepository } from "./repository.js";
import { HttpRiskClient } from "./risk-client.js";
import { createOrdersPool } from "./runtime.js";

const config = loadConfig();
const pool = await createOrdersPool();
const repository = new PostgresOrderRepository(pool);
const riskClient = new HttpRiskClient(
  config.riskBaseUrl,
  config.riskRequestTimeoutMs,
);
const app = createOrdersApp(repository, riskClient);
const server = app.listen(config.port, () => {
  logger.info({ port: config.port }, "Orders API listening");
});

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, "Orders API shutting down");
  server.close(async () => {
    await pool.end();
    await shutdownTelemetry();
    process.exit(0);
  });
}

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));
