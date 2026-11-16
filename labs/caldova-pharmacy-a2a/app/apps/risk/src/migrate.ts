import { logger } from "@caldova/platform";

import { createRiskPool } from "./runtime.js";

const pool = await createRiskPool();
await pool.end();
logger.info("Medication Risk database migrations completed");
