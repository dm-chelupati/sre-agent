import type { CreateOrderRequest, Order } from "@caldova/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createOrder } from "./api.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("pharmacy portal API", () => {
  it("submits prescriptions only through the platform gateway", async () => {
    const payload: CreateOrderRequest = {
      patient: {
        id: "PAT-400",
        dateOfBirth: "1988-01-02",
        allergies: [],
        currentMedications: [],
      },
      prescription: {
        medicationName: "Amoxicillin",
        strengthMg: 500,
        doseMg: 500,
        frequencyPerDay: 3,
        quantity: 21,
      },
      prescriber: { id: "NPI-400", name: "Dr. Casey Rowan" },
    };
    const responseOrder: Order = {
      id: crypto.randomUUID(),
      ...payload,
      status: "accepted",
      riskAssessmentId: crypto.randomUUID(),
      riskLevel: "low",
      createdAt: new Date().toISOString(),
    };
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(responseOrder), {
        status: 201,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(createOrder(payload)).resolves.toEqual(responseOrder);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/orders");
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: "POST" });
  });
});
