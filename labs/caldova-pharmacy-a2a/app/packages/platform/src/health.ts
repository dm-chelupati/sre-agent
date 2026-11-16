import { Router } from "express";

import { asyncHandler } from "./errors.js";

export interface DependencyStatus {
  name: string;
  status: "available" | "unavailable";
  durationMs: number;
}

export interface DependencyCheck {
  name: string;
  check: () => Promise<void>;
}

export interface HealthRouterOptions {
  serviceName: string;
  dependencies?: readonly DependencyCheck[];
}

async function checkDependencies(
  checks: readonly DependencyCheck[],
): Promise<DependencyStatus[]> {
  return Promise.all(
    checks.map(async ({ name, check }) => {
      const started = performance.now();
      try {
        await check();
        return {
          name,
          status: "available" as const,
          durationMs: Math.round(performance.now() - started),
        };
      } catch {
        return {
          name,
          status: "unavailable" as const,
          durationMs: Math.round(performance.now() - started),
        };
      }
    }),
  );
}

export function createHealthRouter(options: HealthRouterOptions): Router {
  const router = Router();
  const dependencies = options.dependencies ?? [];

  router.get("/live", (_request, response) => {
    response.json({
      service: options.serviceName,
      status: "live",
      uptimeSeconds: Math.floor(process.uptime()),
      checkedAt: new Date().toISOString(),
    });
  });

  router.get(
    "/ready",
    asyncHandler(async (_request, response) => {
      const statuses = await checkDependencies(dependencies);
      const ready = statuses.every(({ status }) => status === "available");
      response.status(ready ? 200 : 503).json({
        service: options.serviceName,
        status: ready ? "ready" : "not_ready",
        checkedAt: new Date().toISOString(),
      });
    }),
  );

  router.get(
    "/dependencies",
    asyncHandler(async (_request, response) => {
      const statuses = await checkDependencies(dependencies);
      const available = statuses.every(
        ({ status }) => status === "available",
      );
      response.status(available ? 200 : 503).json({
        service: options.serviceName,
        status: available ? "available" : "degraded",
        dependencies: statuses,
        checkedAt: new Date().toISOString(),
      });
    }),
  );

  return router;
}
