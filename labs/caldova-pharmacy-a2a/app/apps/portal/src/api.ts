import {
  ApiErrorSchema,
  OrderListSchema,
  OrderSchema,
  type CreateOrderRequest,
  type Order,
  type OrderList,
} from "@caldova/contracts";

export class PharmacyApiError extends Error {
  public constructor(
    message: string,
    public readonly code: string,
    public readonly correlationId?: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "PharmacyApiError";
  }
}

async function parseResponse<T>(
  response: Response,
  parse: (value: unknown) => T,
): Promise<T> {
  const body: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const parsedError = ApiErrorSchema.safeParse(body);
    if (parsedError.success) {
      throw new PharmacyApiError(
        parsedError.data.error.message,
        parsedError.data.error.code,
        parsedError.data.error.correlationId,
        parsedError.data.error.details,
      );
    }
    throw new PharmacyApiError(
      "The request could not be completed.",
      "request_failed",
    );
  }
  return parse(body);
}

export async function listOrders(signal?: AbortSignal): Promise<OrderList> {
  const response = await fetch("/api/orders?limit=25", {
    headers: { accept: "application/json" },
    ...(signal === undefined ? {} : { signal }),
  });
  return parseResponse(response, (value) => OrderListSchema.parse(value));
}

export async function createOrder(
  payload: CreateOrderRequest,
): Promise<Order> {
  const response = await fetch("/api/orders", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": crypto.randomUUID(),
    },
    body: JSON.stringify(payload),
  });
  return parseResponse(response, (value) => OrderSchema.parse(value));
}
