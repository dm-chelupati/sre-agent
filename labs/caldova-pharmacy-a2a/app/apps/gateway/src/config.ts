import { fileURLToPath } from "node:url";

import { z } from "zod";

const defaultPortalDirectory = fileURLToPath(
  new URL("../../portal/dist", import.meta.url),
);

const ConfigSchema = z.object({
  port: z.coerce.number().int().positive().max(65_535).default(8080),
  ordersBaseUrl: z.url(),
  ordersRequestTimeoutMs: z.coerce
    .number()
    .int()
    .positive()
    .max(30_000)
    .default(5_000),
  portalDirectory: z.string().min(1).default(defaultPortalDirectory),
});

export type GatewayConfig = z.infer<typeof ConfigSchema>;

export function loadConfig(
  environment: NodeJS.ProcessEnv = process.env,
): GatewayConfig {
  return ConfigSchema.parse({
    port: environment.GATEWAY_PORT,
    ordersBaseUrl: environment.ORDERS_BASE_URL,
    ordersRequestTimeoutMs: environment.ORDERS_REQUEST_TIMEOUT_MS,
    portalDirectory: environment.PORTAL_DIST_PATH,
  });
}
