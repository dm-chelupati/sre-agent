import {
  RiskAssessmentSchema,
  type RiskAssessment,
  type RiskAssessmentRequest,
} from "@caldova/contracts";
import {
  AppError,
  CORRELATION_HEADER,
} from "@caldova/platform";

export interface RiskClient {
  assess(
    request: RiskAssessmentRequest,
    correlationId: string,
  ): Promise<RiskAssessment>;
  checkHealth(): Promise<void>;
}

export class HttpRiskClient implements RiskClient {
  public constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs: number,
  ) {}

  private async request(
    path: string,
    init: RequestInit,
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await fetch(new URL(path, this.baseUrl), {
        ...init,
        signal: controller.signal,
      });
    } catch (error) {
      throw new AppError(
        503,
        "medication_risk_unavailable",
        "Medication safety validation is temporarily unavailable.",
        error instanceof Error ? { cause: error.name } : undefined,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  public async assess(
    request: RiskAssessmentRequest,
    correlationId: string,
  ): Promise<RiskAssessment> {
    const response = await this.request("/api/v1/risk-assessments", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [CORRELATION_HEADER]: correlationId,
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      throw new AppError(
        503,
        "medication_risk_unavailable",
        "Medication safety validation is temporarily unavailable.",
        { dependencyStatus: response.status },
      );
    }

    return RiskAssessmentSchema.parse(await response.json());
  }

  public async checkHealth(): Promise<void> {
    const response = await this.request("/health/ready", {
      method: "GET",
      headers: { accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error(`Medication Risk health returned ${response.status}`);
    }
  }
}
