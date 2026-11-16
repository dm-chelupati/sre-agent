import {
  ApiErrorSchema,
  OrderListSchema,
  OrderSchema,
  type CreateOrderRequest,
  type Order,
  type OrderList,
} from "@caldova/contracts";
import {
  AppError,
  CORRELATION_HEADER,
} from "@caldova/platform";

export interface OrdersClient {
  create(
    payload: CreateOrderRequest,
    correlationId: string,
    idempotencyKey: string,
  ): Promise<{ order: Order; status: 200 | 201 }>;
  list(
    limit: number,
    cursor: string | undefined,
    correlationId: string,
  ): Promise<OrderList>;
  get(id: string, correlationId: string): Promise<Order>;
  checkHealth(): Promise<void>;
}

export class HttpOrdersClient implements OrdersClient {
  public constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs: number,
  ) {}

  private async request(
    path: string,
    correlationId: string | undefined,
    init: RequestInit,
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await fetch(new URL(path, this.baseUrl), {
        ...init,
        headers: {
          accept: "application/json",
          ...(correlationId === undefined
            ? {}
            : { [CORRELATION_HEADER]: correlationId }),
          ...init.headers,
        },
        signal: controller.signal,
      });
    } catch (error) {
      throw new AppError(
        503,
        "orders_unavailable",
        "Prescription ordering is temporarily unavailable.",
        error instanceof Error ? { cause: error.name } : undefined,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  private async parseError(response: Response): Promise<never> {
    const parsed = ApiErrorSchema.safeParse(
      await response.json().catch(() => undefined),
    );
    if (parsed.success && response.status < 500) {
      throw new AppError(
        response.status,
        parsed.data.error.code,
        parsed.data.error.message,
        parsed.data.error.details,
      );
    }
    throw new AppError(
      503,
      "orders_unavailable",
      "Prescription ordering is temporarily unavailable.",
      { dependencyStatus: response.status },
    );
  }

  public async create(
    payload: CreateOrderRequest,
    correlationId: string,
    idempotencyKey: string,
  ): Promise<{ order: Order; status: 200 | 201 }> {
    const response = await this.request("/api/v1/orders", correlationId, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": idempotencyKey,
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      return this.parseError(response);
    }
    return {
      order: OrderSchema.parse(await response.json()),
      status: response.status === 200 ? 200 : 201,
    };
  }

  public async list(
    limit: number,
    cursor: string | undefined,
    correlationId: string,
  ): Promise<OrderList> {
    const query = new URLSearchParams({ limit: String(limit) });
    if (cursor !== undefined) {
      query.set("cursor", cursor);
    }
    const response = await this.request(
      `/api/v1/orders?${query.toString()}`,
      correlationId,
      { method: "GET" },
    );
    if (!response.ok) {
      return this.parseError(response);
    }
    return OrderListSchema.parse(await response.json());
  }

  public async get(id: string, correlationId: string): Promise<Order> {
    const response = await this.request(
      `/api/v1/orders/${encodeURIComponent(id)}`,
      correlationId,
      { method: "GET" },
    );
    if (!response.ok) {
      return this.parseError(response);
    }
    return OrderSchema.parse(await response.json());
  }

  public async checkHealth(): Promise<void> {
    const response = await this.request(
      "/health/ready",
      undefined,
      { method: "GET" },
    );
    if (!response.ok) {
      throw new Error(`Orders health returned ${response.status}`);
    }
  }
}
