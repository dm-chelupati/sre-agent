import { logger } from "@caldova/platform";
import { shutdownTelemetry } from "@caldova/platform/telemetry";

import { createRiskApp } from "./app.js";
import { loadConfig } from "./config.js";
import { PostgresRiskAssessmentRepository } from "./repository.js";
import { createRiskPool } from "./runtime.js";

const config = loadConfig();
const pool = await createRiskPool();
const app = createRiskApp(new PostgresRiskAssessmentRepository(pool));
const server = app.listen(config.port, () => {
  logger.info({ port: config.port }, "Medication Risk API listening");
});

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, "Medication Risk API shutting down");
  server.close(async () => {
    await pool.end();
    await shutdownTelemetry();
    process.exit(0);
  });
}

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));
