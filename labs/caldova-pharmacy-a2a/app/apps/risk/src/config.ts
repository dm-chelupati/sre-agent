import { z } from "zod";

const ConfigSchema = z.object({
  port: z.coerce.number().int().positive().max(65_535).default(8082),
  databaseUrl: z.url(),
  databasePoolSize: z.coerce.number().int().positive().max(50).default(10),
});

export type RiskConfig = z.infer<typeof ConfigSchema>;

export function loadConfig(
  environment: NodeJS.ProcessEnv = process.env,
): RiskConfig {
  return ConfigSchema.parse({
    port: environment.RISK_PORT,
    databaseUrl: environment.RISK_DATABASE_URL,
    databasePoolSize: environment.RISK_DATABASE_POOL_SIZE,
  });
}
