import { randomUUID } from "node:crypto";

import {
  type RiskAssessment,
  type RiskAssessmentRequest,
} from "@caldova/contracts";
import { getMeter, getTracer } from "@caldova/platform";

import type { RiskAssessmentRepository } from "./repository.js";
import { evaluateMedicationRisk } from "./risk-engine.js";

const tracer = getTracer("risk");
const assessmentCounter = getMeter("risk").createCounter(
  "caldova.risk.assessments",
  { description: "Medication risk assessments completed" },
);

export class RiskAssessmentService {
  public constructor(
    private readonly repository: RiskAssessmentRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public async assess(
    request: RiskAssessmentRequest,
    correlationId: string,
  ): Promise<RiskAssessment> {
    return tracer.startActiveSpan("assess-medication-risk", async (span) => {
      try {
        const decision = evaluateMedicationRisk(request, this.now());
        const assessment: RiskAssessment = {
          id: randomUUID(),
          orderId: request.orderId,
          ...decision,
          assessedAt: this.now().toISOString(),
        };
        await this.repository.save(assessment, request, correlationId);
        assessmentCounter.add(1, {
          outcome: assessment.outcome,
          riskLevel: assessment.riskLevel,
        });
        return assessment;
      } catch (error) {
        span.recordException(
          error instanceof Error ? error : new Error(String(error)),
        );
        throw error;
      } finally {
        span.end();
      }
    });
  }

  public findById(id: string): Promise<RiskAssessment | null> {
    return this.repository.findById(id);
  }
}
