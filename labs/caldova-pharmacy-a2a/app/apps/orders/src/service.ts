import { randomUUID } from "node:crypto";

import type {
  CreateOrderRequest,
  Order,
  OrderList,
} from "@caldova/contracts";
import {
  AppError,
  getMeter,
  getTracer,
} from "@caldova/platform";
import { SpanStatusCode } from "@opentelemetry/api";

import type { OrderRepository } from "./repository.js";
import type { RiskClient } from "./risk-client.js";

const tracer = getTracer("orders");
const orderCounter = getMeter("orders").createCounter(
  "caldova.orders.accepted",
  { description: "Prescription orders accepted" },
);

export interface CreateOrderResult {
  order: Order;
  created: boolean;
}

export class OrderService {
  public constructor(
    private readonly repository: OrderRepository,
    private readonly riskClient: RiskClient,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public async create(
    request: CreateOrderRequest,
    idempotencyKey: string,
    correlationId: string,
  ): Promise<CreateOrderResult> {
    const existing =
      await this.repository.findByIdempotencyKey(idempotencyKey);
    if (existing !== null) {
      return { order: existing, created: false };
    }

    return tracer.startActiveSpan("accept-prescription-order", async (span) => {
      const orderId = randomUUID();
      span.setAttribute("caldova.order.id", orderId);
      try {
        const assessment = await this.riskClient.assess(
          {
            orderId,
            patient: request.patient,
            prescription: request.prescription,
          },
          correlationId,
        );

        span.setAttribute("caldova.risk.outcome", assessment.outcome);
        span.setAttribute("caldova.risk.level", assessment.riskLevel);
        if (assessment.outcome !== "approved") {
          throw new AppError(
            422,
            "medication_risk_rejected",
            "The prescription did not pass medication safety validation.",
            {
              assessmentId: assessment.id,
              riskLevel: assessment.riskLevel,
              reasons: assessment.reasons,
            },
          );
        }

        const order: Order = {
          id: orderId,
          ...request,
          status: "accepted",
          riskAssessmentId: assessment.id,
          riskLevel: assessment.riskLevel,
          createdAt: this.now().toISOString(),
        };
        const created = await this.repository.save(
          order,
          idempotencyKey,
          correlationId,
        );

        if (!created) {
          const concurrent =
            await this.repository.findByIdempotencyKey(idempotencyKey);
          if (concurrent !== null) {
            return { order: concurrent, created: false };
          }
          throw new Error("Order idempotency conflict could not be resolved");
        }

        orderCounter.add(1, { riskLevel: order.riskLevel });
        return { order, created: true };
      } catch (error) {
        span.recordException(
          error instanceof Error ? error : new Error(String(error)),
        );
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : String(error),
        });
        throw error;
      } finally {
        span.end();
      }
    });
  }

  public findById(id: string): Promise<Order | null> {
    return this.repository.findById(id);
  }

  public list(limit: number, cursor?: string): Promise<OrderList> {
    return this.repository.list(limit, cursor);
  }
}
