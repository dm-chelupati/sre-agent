import { randomUUID } from "node:crypto";

import type { NextFunction, Request, Response } from "express";

export const CORRELATION_HEADER = "x-correlation-id";

const validCorrelationId = /^[a-zA-Z0-9._:/-]{1,128}$/;

export function correlationMiddleware(
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  const supplied = request.header(CORRELATION_HEADER)?.trim();
  const correlationId =
    supplied !== undefined && validCorrelationId.test(supplied)
      ? supplied
      : randomUUID();

  response.locals.correlationId = correlationId;
  response.setHeader(CORRELATION_HEADER, correlationId);
  next();
}

export function getCorrelationId(response: Response): string {
  const value: unknown = response.locals.correlationId;
  return typeof value === "string" ? value : randomUUID();
}
