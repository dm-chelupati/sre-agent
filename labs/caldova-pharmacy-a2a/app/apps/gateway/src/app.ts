import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";

import { CreateOrderRequestSchema } from "@caldova/contracts";
import {
  asyncHandler,
  correlationMiddleware,
  createHealthRouter,
  errorHandler,
  getCorrelationId,
  notFoundHandler,
  requestLogger,
} from "@caldova/platform";
import compression from "compression";
import express, { type Express } from "express";
import helmet from "helmet";
import { z } from "zod";

import type { OrdersClient } from "./orders-client.js";

const ListQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).default(25),
  cursor: z.string().min(1).max(500).optional(),
});
const IdParameterSchema = z.object({ id: z.uuid() });

export interface GatewayAppOptions {
  portalDirectory?: string;
}

export function createGatewayApp(
  ordersClient: OrdersClient,
  options: GatewayAppOptions = {},
): Express {
  const app = express();

  app.disable("x-powered-by");
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          connectSrc: ["'self'"],
          imgSrc: ["'self'", "data:"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
        },
      },
    }),
  );
  app.use(compression());
  app.use(correlationMiddleware);
  app.use(requestLogger);
  app.use(express.json({ limit: "64kb" }));
  app.use(
    "/health",
    createHealthRouter({
      serviceName: "caldova-platform-gateway",
      dependencies: [
        {
          name: "orders-api",
          check: () => ordersClient.checkHealth(),
        },
      ],
    }),
  );

  app.post(
    "/api/orders",
    asyncHandler(async (request, response) => {
      const payload = CreateOrderRequestSchema.parse(request.body);
      const idempotencyKey =
        request.header("idempotency-key") ?? randomUUID();
      const result = await ordersClient.create(
        payload,
        getCorrelationId(response),
        idempotencyKey,
      );
      response.setHeader("idempotency-key", idempotencyKey);
      response.status(result.status).json(result.order);
    }),
  );

  app.get(
    "/api/orders",
    asyncHandler(async (request, response) => {
      const query = ListQuerySchema.parse(request.query);
      const result = await ordersClient.list(
        query.limit,
        query.cursor,
        getCorrelationId(response),
      );
      response.json(result);
    }),
  );

  app.get(
    "/api/orders/:id",
    asyncHandler(async (request, response) => {
      const { id } = IdParameterSchema.parse(request.params);
      const order = await ordersClient.get(id, getCorrelationId(response));
      response.json(order);
    }),
  );

  if (
    options.portalDirectory !== undefined &&
    existsSync(path.join(options.portalDirectory, "index.html"))
  ) {
    app.use(
      express.static(options.portalDirectory, {
        fallthrough: true,
        immutable: true,
        maxAge: "1y",
        index: false,
        setHeaders(response, filename) {
          if (filename.endsWith("index.html")) {
            response.setHeader("cache-control", "no-cache");
          }
        },
      }),
    );
    app.get("*", (request, response, next) => {
      if (request.accepts("html") === false || request.path.startsWith("/api/")) {
        next();
        return;
      }
      response.sendFile(path.join(options.portalDirectory!, "index.html"));
    });
  }

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
