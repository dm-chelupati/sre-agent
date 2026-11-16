import { logger } from "@caldova/platform";

import { createOrdersPool } from "./runtime.js";

const pool = await createOrdersPool();
await pool.end();
logger.info("Orders database migrations completed");
