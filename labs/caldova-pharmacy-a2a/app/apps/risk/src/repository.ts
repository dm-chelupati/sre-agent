import {
  RiskAssessmentSchema,
  type RiskAssessment,
  type RiskAssessmentRequest,
} from "@caldova/contracts";
import type { Pool } from "pg";

export interface RiskAssessmentRepository {
  save(
    assessment: RiskAssessment,
    request: RiskAssessmentRequest,
    correlationId: string,
  ): Promise<void>;
  findById(id: string): Promise<RiskAssessment | null>;
  checkConnection(): Promise<void>;
}

interface AssessmentRow {
  id: string;
  order_id: string;
  outcome: string;
  risk_level: string;
  reasons: string[];
  assessed_at: Date;
}

function mapAssessment(row: AssessmentRow): RiskAssessment {
  return RiskAssessmentSchema.parse({
    id: row.id,
    orderId: row.order_id,
    outcome: row.outcome,
    riskLevel: row.risk_level,
    reasons: row.reasons,
    assessedAt: row.assessed_at.toISOString(),
  });
}

export class PostgresRiskAssessmentRepository
  implements RiskAssessmentRepository
{
  public constructor(private readonly pool: Pool) {}

  public async save(
    assessment: RiskAssessment,
    request: RiskAssessmentRequest,
    correlationId: string,
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO risk_assessments (
        id, order_id, outcome, risk_level, reasons, request_payload,
        correlation_id, assessed_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        assessment.id,
        assessment.orderId,
        assessment.outcome,
        assessment.riskLevel,
        assessment.reasons,
        request,
        correlationId,
        assessment.assessedAt,
      ],
    );
  }

  public async findById(id: string): Promise<RiskAssessment | null> {
    const result = await this.pool.query<AssessmentRow>(
      `SELECT id, order_id, outcome, risk_level, reasons, assessed_at
       FROM risk_assessments
       WHERE id = $1`,
      [id],
    );
    const row = result.rows[0];
    return row === undefined ? null : mapAssessment(row);
  }

  public async checkConnection(): Promise<void> {
    await this.pool.query("SELECT 1");
  }
}
