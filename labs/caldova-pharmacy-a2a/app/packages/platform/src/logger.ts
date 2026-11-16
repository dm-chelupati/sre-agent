import { randomUUID } from "node:crypto";

import pino from "pino";
import { pinoHttp } from "pino-http";

import { CORRELATION_HEADER } from "./correlation.js";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "request.headers.authorization",
      "patient",
    ],
    censor: "[REDACTED]",
  },
});

export const requestLogger = pinoHttp({
  logger,
  genReqId(request, response) {
    const header = request.headers[CORRELATION_HEADER];
    const correlationId =
      typeof header === "string" ? header : response.getHeader(CORRELATION_HEADER);
    return typeof correlationId === "string" ? correlationId : randomUUID();
  },
  customProps(_request, response) {
    const correlationId = response.getHeader(CORRELATION_HEADER);
    return typeof correlationId === "string" ? { correlationId } : {};
  },
});
