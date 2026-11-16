import {
  OrderSchema,
  type Order,
  type OrderList,
} from "@caldova/contracts";
import type { Pool } from "pg";

export interface OrderRepository {
  save(
    order: Order,
    idempotencyKey: string,
    correlationId: string,
  ): Promise<boolean>;
  findById(id: string): Promise<Order | null>;
  findByIdempotencyKey(idempotencyKey: string): Promise<Order | null>;
  list(limit: number, cursor?: string): Promise<OrderList>;
  checkConnection(): Promise<void>;
}

interface OrderRow {
  id: string;
  patient_id: string;
  patient_date_of_birth: string | Date;
  patient_allergies: string[];
  patient_current_medications: string[];
  prescriber_id: string;
  prescriber_name: string;
  medication_name: string;
  rxnorm_code: string | null;
  strength_mg: string;
  dose_mg: string;
  frequency_per_day: number;
  quantity: number;
  status: "accepted";
  risk_assessment_id: string;
  risk_level: "low" | "moderate" | "high";
  created_at: Date;
}

function toDate(value: string | Date): string {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  return value;
}

function mapOrder(row: OrderRow): Order {
  return OrderSchema.parse({
    id: row.id,
    patient: {
      id: row.patient_id,
      dateOfBirth: toDate(row.patient_date_of_birth),
      allergies: row.patient_allergies,
      currentMedications: row.patient_current_medications,
    },
    prescription: {
      medicationName: row.medication_name,
      ...(row.rxnorm_code === null ? {} : { rxNormCode: row.rxnorm_code }),
      strengthMg: Number(row.strength_mg),
      doseMg: Number(row.dose_mg),
      frequencyPerDay: row.frequency_per_day,
      quantity: row.quantity,
    },
    prescriber: {
      id: row.prescriber_id,
      name: row.prescriber_name,
    },
    status: row.status,
    riskAssessmentId: row.risk_assessment_id,
    riskLevel: row.risk_level,
    createdAt: row.created_at.toISOString(),
  });
}

const selectColumns = `
  id, patient_id, patient_date_of_birth, patient_allergies,
  patient_current_medications, prescriber_id, prescriber_name,
  medication_name, rxnorm_code, strength_mg, dose_mg,
  frequency_per_day, quantity, status, risk_assessment_id,
  risk_level, created_at
`;

function encodeCursor(order: Order): string {
  return Buffer.from(`${order.createdAt}|${order.id}`, "utf8").toString(
    "base64url",
  );
}

function decodeCursor(cursor: string): [string, string] {
  const [createdAt, id, ...remainder] = Buffer.from(cursor, "base64url")
    .toString("utf8")
    .split("|");
  if (
    createdAt === undefined ||
    id === undefined ||
    remainder.length > 0 ||
    Number.isNaN(Date.parse(createdAt))
  ) {
    throw new Error("Invalid cursor");
  }
  return [createdAt, id];
}

export class PostgresOrderRepository implements OrderRepository {
  public constructor(private readonly pool: Pool) {}

  public async save(
    order: Order,
    idempotencyKey: string,
    correlationId: string,
  ): Promise<boolean> {
    const result = await this.pool.query(
      `INSERT INTO orders (
        id, patient_id, patient_date_of_birth, patient_allergies,
        patient_current_medications, prescriber_id, prescriber_name,
        medication_name, rxnorm_code, strength_mg, dose_mg,
        frequency_per_day, quantity, status, risk_assessment_id,
        risk_level, idempotency_key, correlation_id, created_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15, $16, $17, $18, $19
      )
      ON CONFLICT (idempotency_key) DO NOTHING
      RETURNING id`,
      [
        order.id,
        order.patient.id,
        order.patient.dateOfBirth,
        order.patient.allergies,
        order.patient.currentMedications,
        order.prescriber.id,
        order.prescriber.name,
        order.prescription.medicationName,
        order.prescription.rxNormCode ?? null,
        order.prescription.strengthMg,
        order.prescription.doseMg,
        order.prescription.frequencyPerDay,
        order.prescription.quantity,
        order.status,
        order.riskAssessmentId,
        order.riskLevel,
        idempotencyKey,
        correlationId,
        order.createdAt,
      ],
    );
    return result.rowCount === 1;
  }

  public async findById(id: string): Promise<Order | null> {
    const result = await this.pool.query<OrderRow>(
      `SELECT ${selectColumns} FROM orders WHERE id = $1`,
      [id],
    );
    const row = result.rows[0];
    return row === undefined ? null : mapOrder(row);
  }

  public async findByIdempotencyKey(
    idempotencyKey: string,
  ): Promise<Order | null> {
    const result = await this.pool.query<OrderRow>(
      `SELECT ${selectColumns} FROM orders WHERE idempotency_key = $1`,
      [idempotencyKey],
    );
    const row = result.rows[0];
    return row === undefined ? null : mapOrder(row);
  }

  public async list(limit: number, cursor?: string): Promise<OrderList> {
    const values: unknown[] = [];
    let cursorClause = "";
    if (cursor !== undefined) {
      const [createdAt, id] = decodeCursor(cursor);
      values.push(createdAt, id);
      cursorClause = "WHERE (created_at, id) < ($1::timestamptz, $2::uuid)";
    }
    values.push(limit + 1);
    const limitParameter = `$${values.length}`;
    const result = await this.pool.query<OrderRow>(
      `SELECT ${selectColumns}
       FROM orders
       ${cursorClause}
       ORDER BY created_at DESC, id DESC
       LIMIT ${limitParameter}`,
      values,
    );
    const orders = result.rows.map(mapOrder);
    const hasNextPage = orders.length > limit;
    const items = orders.slice(0, limit);
    const last = items.at(-1);
    return {
      items,
      nextCursor:
        hasNextPage && last !== undefined ? encodeCursor(last) : null,
    };
  }

  public async checkConnection(): Promise<void> {
    await this.pool.query("SELECT 1");
  }
}
