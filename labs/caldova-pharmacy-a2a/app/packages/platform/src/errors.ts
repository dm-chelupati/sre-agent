import type { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError } from "zod";

import { getCorrelationId } from "./correlation.js";
import { logger } from "./logger.js";

export class AppError extends Error {
  public constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const notFoundHandler: RequestHandler = (_request, response) => {
  const correlationId = getCorrelationId(response);
  response.status(404).json({
    error: {
      code: "not_found",
      message: "The requested resource was not found.",
      correlationId,
    },
  });
};

export const errorHandler: ErrorRequestHandler = (
  error: unknown,
  _request,
  response,
  _next,
) => {
  const correlationId = getCorrelationId(response);

  if (error instanceof ZodError) {
    response.status(400).json({
      error: {
        code: "invalid_request",
        message: "The request payload is invalid.",
        correlationId,
        details: error.issues,
      },
    });
    return;
  }

  if (error instanceof AppError) {
    response.status(error.status).json({
      error: {
        code: error.code,
        message: error.message,
        correlationId,
        ...(error.details === undefined ? {} : { details: error.details }),
      },
    });
    return;
  }

  logger.error({ error, correlationId }, "Unhandled request error");
  response.status(500).json({
    error: {
      code: "internal_error",
      message: "The request could not be completed.",
      correlationId,
    },
  });
};

export function asyncHandler(
  handler: (
    ...args: Parameters<RequestHandler>
  ) => Promise<void>,
): RequestHandler {
  return (request, response, next) => {
    void handler(request, response, next).catch(next);
  };
}
