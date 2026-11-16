import { z } from "zod";

const ConfigSchema = z.object({
  port: z.coerce.number().int().positive().max(65_535).default(8081),
  databaseUrl: z.url(),
  databasePoolSize: z.coerce.number().int().positive().max(50).default(10),
  riskBaseUrl: z.url(),
  riskRequestTimeoutMs: z.coerce
    .number()
    .int()
    .positive()
    .max(30_000)
    .default(5_000),
});

export type OrdersConfig = z.infer<typeof ConfigSchema>;

export function loadConfig(
  environment: NodeJS.ProcessEnv = process.env,
): OrdersConfig {
  return ConfigSchema.parse({
    port: environment.ORDERS_PORT,
    databaseUrl: environment.ORDERS_DATABASE_URL,
    databasePoolSize: environment.ORDERS_DATABASE_POOL_SIZE,
    riskBaseUrl: environment.RISK_BASE_URL,
    riskRequestTimeoutMs: environment.RISK_REQUEST_TIMEOUT_MS,
  });
}
