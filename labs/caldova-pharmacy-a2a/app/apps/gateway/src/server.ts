import { logger } from "@caldova/platform";
import { shutdownTelemetry } from "@caldova/platform/telemetry";

import { createGatewayApp } from "./app.js";
import { loadConfig } from "./config.js";
import { HttpOrdersClient } from "./orders-client.js";

const config = loadConfig();
const ordersClient = new HttpOrdersClient(
  config.ordersBaseUrl,
  config.ordersRequestTimeoutMs,
);
const app = createGatewayApp(ordersClient, {
  portalDirectory: config.portalDirectory,
});
const server = app.listen(config.port, () => {
  logger.info({ port: config.port }, "Platform gateway listening");
});

function shutdown(signal: string): void {
  logger.info({ signal }, "Platform gateway shutting down");
  server.close(() => {
    void shutdownTelemetry().then(() => process.exit(0));
  });
}

process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));
