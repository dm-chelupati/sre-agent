import { randomUUID } from "node:crypto";

import {
  CreateOrderRequestSchema,
  OrderListSchema,
  OrderSchema,
} from "@caldova/contracts";
import {
  AppError,
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

import type { OrderRepository } from "./repository.js";
import type { RiskClient } from "./risk-client.js";
import { OrderService } from "./service.js";

const IdParameterSchema = z.object({ id: z.uuid() });
const ListQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).default(25),
  cursor: z.string().min(1).max(500).optional(),
});
const idempotencyPattern = /^[a-zA-Z0-9._:/-]{1,128}$/;

export function createOrdersApp(
  repository: OrderRepository,
  riskClient: RiskClient,
): Express {
  const app = express();
  const service = new OrderService(repository, riskClient);

  app.disable("x-powered-by");
  app.use(helmet());
  app.use(compression());
  app.use(correlationMiddleware);
  app.use(requestLogger);
  app.use(express.json({ limit: "64kb" }));
  app.use(
    "/health",
    createHealthRouter({
      serviceName: "caldova-orders",
      dependencies: [
        {
          name: "orders-postgresql",
          check: () => repository.checkConnection(),
        },
        {
          name: "medication-risk-api",
          check: () => riskClient.checkHealth(),
        },
      ],
    }),
  );

  app.post(
    "/api/v1/orders",
    asyncHandler(async (request, response) => {
      const payload = CreateOrderRequestSchema.parse(request.body);
      const suppliedIdempotencyKey = request.header("idempotency-key");
      const idempotencyKey = suppliedIdempotencyKey ?? randomUUID();
      if (!idempotencyPattern.test(idempotencyKey)) {
        throw new AppError(
          400,
          "invalid_idempotency_key",
          "The Idempotency-Key header is invalid.",
        );
      }

      const result = await service.create(
        payload,
        idempotencyKey,
        getCorrelationId(response),
      );
      response.setHeader("idempotency-key", idempotencyKey);
      response
        .status(result.created ? 201 : 200)
        .json(OrderSchema.parse(result.order));
    }),
  );

  app.get(
    "/api/v1/orders",
    asyncHandler(async (request, response) => {
      const query = ListQuerySchema.parse(request.query);
      const orders = await service.list(query.limit, query.cursor);
      response.json(OrderListSchema.parse(orders));
    }),
  );

  app.get(
    "/api/v1/orders/:id",
    asyncHandler(async (request, response) => {
      const { id } = IdParameterSchema.parse(request.params);
      const order = await service.findById(id);
      if (order === null) {
        throw new AppError(
          404,
          "order_not_found",
          "The prescription order was not found.",
        );
      }
      response.json(OrderSchema.parse(order));
    }),
  );

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
