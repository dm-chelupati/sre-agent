import { z } from "zod";

const nonBlank = z.string().trim().min(1).max(200);
const medicationName = z.string().trim().min(2).max(120);

export const PatientSchema = z.object({
  id: z.string().trim().min(1).max(80),
  dateOfBirth: z.iso.date(),
  allergies: z.array(medicationName).max(30).default([]),
  currentMedications: z.array(medicationName).max(50).default([]),
});

export const PrescriptionSchema = z.object({
  medicationName,
  rxNormCode: z.string().trim().min(1).max(40).optional(),
  strengthMg: z.number().positive().max(100_000),
  doseMg: z.number().positive().max(100_000),
  frequencyPerDay: z.number().int().positive().max(24),
  quantity: z.number().int().positive().max(10_000),
});

export const PrescriberSchema = z.object({
  id: z.string().trim().min(1).max(80),
  name: nonBlank,
});

export const CreateOrderRequestSchema = z.object({
  patient: PatientSchema,
  prescription: PrescriptionSchema,
  prescriber: PrescriberSchema,
});

export const RiskAssessmentRequestSchema = z.object({
  orderId: z.uuid(),
  patient: PatientSchema,
  prescription: PrescriptionSchema,
});

export const RiskOutcomeSchema = z.enum(["approved", "rejected"]);
export const RiskLevelSchema = z.enum(["low", "moderate", "high"]);

export const RiskAssessmentSchema = z.object({
  id: z.uuid(),
  orderId: z.uuid(),
  outcome: RiskOutcomeSchema,
  riskLevel: RiskLevelSchema,
  reasons: z.array(z.string()),
  assessedAt: z.iso.datetime(),
});

export const OrderStatusSchema = z.literal("accepted");

export const OrderSchema = z.object({
  id: z.uuid(),
  patient: PatientSchema,
  prescription: PrescriptionSchema,
  prescriber: PrescriberSchema,
  status: OrderStatusSchema,
  riskAssessmentId: z.uuid(),
  riskLevel: RiskLevelSchema,
  createdAt: z.iso.datetime(),
});

export const OrderListSchema = z.object({
  items: z.array(OrderSchema),
  nextCursor: z.string().nullable(),
});

export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    correlationId: z.string(),
    details: z.unknown().optional(),
  }),
});

export type ApiError = z.infer<typeof ApiErrorSchema>;
export type CreateOrderRequest = z.infer<typeof CreateOrderRequestSchema>;
export type Order = z.infer<typeof OrderSchema>;
export type OrderList = z.infer<typeof OrderListSchema>;
export type Patient = z.infer<typeof PatientSchema>;
export type Prescription = z.infer<typeof PrescriptionSchema>;
export type Prescriber = z.infer<typeof PrescriberSchema>;
export type RiskAssessment = z.infer<typeof RiskAssessmentSchema>;
export type RiskAssessmentRequest = z.infer<typeof RiskAssessmentRequestSchema>;
export type RiskLevel = z.infer<typeof RiskLevelSchema>;
export type RiskOutcome = z.infer<typeof RiskOutcomeSchema>;
