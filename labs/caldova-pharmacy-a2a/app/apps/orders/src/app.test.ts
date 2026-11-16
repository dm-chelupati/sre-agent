import { randomUUID } from "node:crypto";

import type {
  CreateOrderRequest,
  Order,
  OrderList,
  RiskAssessment,
  RiskAssessmentRequest,
} from "@caldova/contracts";
import request from "supertest";
import { describe, expect, it } from "vitest";

import { createOrdersApp } from "./app.js";
import type { OrderRepository } from "./repository.js";
import type { RiskClient } from "./risk-client.js";

class MemoryOrderRepository implements OrderRepository {
  public orders: Order[] = [];
  public events: string[] = [];
  private readonly keys = new Map<string, Order>();

  public async save(order: Order, key: string): Promise<boolean> {
    this.events.push("order-saved");
    if (this.keys.has(key)) {
      return false;
    }
    this.orders.push(order);
    this.keys.set(key, order);
    return true;
  }

  public async findById(id: string): Promise<Order | null> {
    return this.orders.find((order) => order.id === id) ?? null;
  }

  public async findByIdempotencyKey(key: string): Promise<Order | null> {
    return this.keys.get(key) ?? null;
  }

  public async list(): Promise<OrderList> {
    return { items: this.orders, nextCursor: null };
  }

  public async checkConnection(): Promise<void> {}
}

class StubRiskClient implements RiskClient {
  public correlationId?: string;

  public constructor(
    private readonly outcome: "approved" | "rejected",
    private readonly events: string[],
  ) {}

  public async assess(
    input: RiskAssessmentRequest,
    correlationId: string,
  ): Promise<RiskAssessment> {
    this.correlationId = correlationId;
    this.events.push("risk-assessed");
    return {
      id: randomUUID(),
      orderId: input.orderId,
      outcome: this.outcome,
      riskLevel: this.outcome === "approved" ? "low" : "high",
      reasons: this.outcome === "approved" ? [] : ["Medication risk found."],
      assessedAt: new Date().toISOString(),
    };
  }

  public async checkHealth(): Promise<void> {}
}

const orderRequest: CreateOrderRequest = {
  patient: {
    id: "PAT-200",
    dateOfBirth: "1979-08-03",
    allergies: [],
    currentMedications: [],
  },
  prescription: {
    medicationName: "Amoxicillin",
    rxNormCode: "723",
    strengthMg: 500,
    doseMg: 500,
    frequencyPerDay: 3,
    quantity: 21,
  },
  prescriber: { id: "NPI-100", name: "Dr. Avery Chen" },
};

describe("Orders API", () => {
  it("checks medication risk before accepting and saving an order", async () => {
    const repository = new MemoryOrderRepository();
    const riskClient = new StubRiskClient("approved", repository.events);

    const response = await request(createOrdersApp(repository, riskClient))
      .post("/api/v1/orders")
      .set("idempotency-key", "order-test-1")
      .set("x-correlation-id", "correlation-test-1")
      .send(orderRequest)
      .expect(201);

    expect(repository.events).toEqual(["risk-assessed", "order-saved"]);
    expect(riskClient.correlationId).toBe("correlation-test-1");
    expect(response.headers["x-correlation-id"]).toBe("correlation-test-1");
    expect(response.body).toMatchObject({
      status: "accepted",
      riskLevel: "low",
    });
  });

  it("does not save a prescription rejected by medication risk", async () => {
    const repository = new MemoryOrderRepository();
    const riskClient = new StubRiskClient("rejected", repository.events);

    const response = await request(createOrdersApp(repository, riskClient))
      .post("/api/v1/orders")
      .send(orderRequest)
      .expect(422);

    expect(response.body.error.code).toBe("medication_risk_rejected");
    expect(repository.orders).toHaveLength(0);
  });

  it("returns an existing order for a repeated idempotency key", async () => {
    const repository = new MemoryOrderRepository();
    const riskClient = new StubRiskClient("approved", repository.events);
    const app = createOrdersApp(repository, riskClient);

    await request(app)
      .post("/api/v1/orders")
      .set("idempotency-key", "stable-key")
      .send(orderRequest)
      .expect(201);
    await request(app)
      .post("/api/v1/orders")
      .set("idempotency-key", "stable-key")
      .send(orderRequest)
      .expect(200);

    expect(repository.events.filter((event) => event === "risk-assessed")).toHaveLength(1);
    expect(repository.orders).toHaveLength(1);
  });
});
