import {
  RiskAssessmentRequestSchema,
  RiskAssessmentSchema,
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

import type { RiskAssessmentRepository } from "./repository.js";
import { RiskAssessmentService } from "./service.js";

const IdParameterSchema = z.object({ id: z.uuid() });

export function createRiskApp(
  repository: RiskAssessmentRepository,
): Express {
  const app = express();
  const service = new RiskAssessmentService(repository);

  app.disable("x-powered-by");
  app.use(helmet());
  app.use(compression());
  app.use(correlationMiddleware);
  app.use(requestLogger);
  app.use(express.json({ limit: "64kb" }));
  app.use(
    "/health",
    createHealthRouter({
      serviceName: "caldova-medication-risk",
      dependencies: [
        {
          name: "risk-postgresql",
          check: () => repository.checkConnection(),
        },
      ],
    }),
  );

  app.post(
    "/api/v1/risk-assessments",
    asyncHandler(async (request, response) => {
      const payload = RiskAssessmentRequestSchema.parse(request.body);
      const assessment = await service.assess(
        payload,
        getCorrelationId(response),
      );
      response.status(201).json(RiskAssessmentSchema.parse(assessment));
    }),
  );

  app.get(
    "/api/v1/risk-assessments/:id",
    asyncHandler(async (request, response) => {
      const { id } = IdParameterSchema.parse(request.params);
      const assessment = await service.findById(id);
      if (assessment === null) {
        throw new AppError(
          404,
          "risk_assessment_not_found",
          "The medication risk assessment was not found.",
        );
      }
      response.json(RiskAssessmentSchema.parse(assessment));
    }),
  );

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
