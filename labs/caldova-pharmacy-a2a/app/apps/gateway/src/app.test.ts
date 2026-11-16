import { randomUUID } from "node:crypto";

import type {
  CreateOrderRequest,
  Order,
  OrderList,
} from "@caldova/contracts";
import request from "supertest";
import { describe, expect, it } from "vitest";

import { createGatewayApp } from "./app.js";
import type { OrdersClient } from "./orders-client.js";

const payload: CreateOrderRequest = {
  patient: {
    id: "PAT-300",
    dateOfBirth: "1991-11-02",
    allergies: [],
    currentMedications: [],
  },
  prescription: {
    medicationName: "Metformin",
    strengthMg: 500,
    doseMg: 500,
    frequencyPerDay: 2,
    quantity: 60,
  },
  prescriber: { id: "NPI-200", name: "Dr. Morgan Lee" },
};

class CapturingOrdersClient implements OrdersClient {
  public correlationId?: string;

  public async create(
    request: CreateOrderRequest,
    correlationId: string,
  ): Promise<{ order: Order; status: 201 }> {
    this.correlationId = correlationId;
    return {
      status: 201,
      order: {
        id: randomUUID(),
        ...request,
        status: "accepted",
        riskAssessmentId: randomUUID(),
        riskLevel: "low",
        createdAt: new Date().toISOString(),
      },
    };
  }

  public async list(): Promise<OrderList> {
    return { items: [], nextCursor: null };
  }

  public async get(): Promise<Order> {
    throw new Error("Not implemented for this test");
  }

  public async checkHealth(): Promise<void> {}
}

describe("Platform gateway", () => {
  it("propagates the correlation ID to Orders", async () => {
    const ordersClient = new CapturingOrdersClient();
    const response = await request(createGatewayApp(ordersClient))
      .post("/api/orders")
      .set("x-correlation-id", "gateway-test-1")
      .send(payload)
      .expect(201);

    expect(ordersClient.correlationId).toBe("gateway-test-1");
    expect(response.headers["x-correlation-id"]).toBe("gateway-test-1");
    expect(response.body.status).toBe("accepted");
  });

  it("exposes downstream readiness", async () => {
    const response = await request(
      createGatewayApp(new CapturingOrdersClient()),
    )
      .get("/health/dependencies")
      .expect(200);
    expect(response.body).toMatchObject({ status: "available" });
  });
});
