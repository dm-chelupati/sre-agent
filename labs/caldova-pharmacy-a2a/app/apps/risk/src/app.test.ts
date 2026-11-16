import { randomUUID } from "node:crypto";

import type {
  RiskAssessment,
  RiskAssessmentRequest,
} from "@caldova/contracts";
import request from "supertest";
import { describe, expect, it } from "vitest";

import { createRiskApp } from "./app.js";
import type { RiskAssessmentRepository } from "./repository.js";

class MemoryRiskRepository implements RiskAssessmentRepository {
  public assessments: RiskAssessment[] = [];

  public async save(assessment: RiskAssessment): Promise<void> {
    this.assessments.push(assessment);
  }

  public async findById(id: string): Promise<RiskAssessment | null> {
    return this.assessments.find((item) => item.id === id) ?? null;
  }

  public async checkConnection(): Promise<void> {}
}

function assessmentRequest(
  overrides: Partial<RiskAssessmentRequest["prescription"]> = {},
): RiskAssessmentRequest {
  return {
    orderId: randomUUID(),
    patient: {
      id: "PAT-100",
      dateOfBirth: "1985-04-12",
      allergies: [],
      currentMedications: [],
    },
    prescription: {
      medicationName: "Amoxicillin",
      strengthMg: 500,
      doseMg: 500,
      frequencyPerDay: 3,
      quantity: 21,
      ...overrides,
    },
  };
}

describe("Medication Risk API", () => {
  it("persists and approves a low-risk prescription", async () => {
    const repository = new MemoryRiskRepository();
    const response = await request(createRiskApp(repository))
      .post("/api/v1/risk-assessments")
      .set("x-correlation-id", "risk-test-1")
      .send(assessmentRequest())
      .expect(201);

    expect(response.headers["x-correlation-id"]).toBe("risk-test-1");
    expect(response.body).toMatchObject({
      outcome: "approved",
      riskLevel: "low",
      reasons: [],
    });
    expect(repository.assessments).toHaveLength(1);
  });

  it("rejects a prescription that matches a recorded allergy", async () => {
    const repository = new MemoryRiskRepository();
    const payload = assessmentRequest();
    payload.patient.allergies = ["amoxicillin"];

    const response = await request(createRiskApp(repository))
      .post("/api/v1/risk-assessments")
      .send(payload)
      .expect(201);

    expect(response.body).toMatchObject({
      outcome: "rejected",
      riskLevel: "high",
    });
    expect(response.body.reasons).toHaveLength(1);
  });

  it("reports database readiness", async () => {
    const response = await request(
      createRiskApp(new MemoryRiskRepository()),
    )
      .get("/health/ready")
      .expect(200);
    expect(response.body).toMatchObject({ status: "ready" });
  });
});
