import {
  type FormEvent,
  useCallback,
  useEffect,
  useState,
} from "react";

import type {
  CreateOrderRequest,
  Order,
} from "@caldova/contracts";

import {
  createOrder,
  listOrders,
  PharmacyApiError,
} from "./api.js";

interface FormState {
  patientId: string;
  dateOfBirth: string;
  allergies: string;
  currentMedications: string;
  prescriberId: string;
  prescriberName: string;
  medicationName: string;
  rxNormCode: string;
  strengthMg: string;
  doseMg: string;
  frequencyPerDay: string;
  quantity: string;
}

interface Notice {
  tone: "success" | "error";
  message: string;
  reference?: string;
}

const initialForm: FormState = {
  patientId: "",
  dateOfBirth: "",
  allergies: "",
  currentMedications: "",
  prescriberId: "",
  prescriberName: "",
  medicationName: "",
  rxNormCode: "",
  strengthMg: "",
  doseMg: "",
  frequencyPerDay: "",
  quantity: "",
};

function splitList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function asRequest(form: FormState): CreateOrderRequest {
  return {
    patient: {
      id: form.patientId.trim(),
      dateOfBirth: form.dateOfBirth,
      allergies: splitList(form.allergies),
      currentMedications: splitList(form.currentMedications),
    },
    prescription: {
      medicationName: form.medicationName.trim(),
      ...(form.rxNormCode.trim() === ""
        ? {}
        : { rxNormCode: form.rxNormCode.trim() }),
      strengthMg: Number(form.strengthMg),
      doseMg: Number(form.doseMg),
      frequencyPerDay: Number(form.frequencyPerDay),
      quantity: Number(form.quantity),
    },
    prescriber: {
      id: form.prescriberId.trim(),
      name: form.prescriberName.trim(),
    },
  };
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function Field({
  label,
  name,
  value,
  type = "text",
  required = true,
  placeholder,
  min,
  step,
  onChange,
}: {
  label: string;
  name: keyof FormState;
  value: string;
  type?: "text" | "date" | "number";
  required?: boolean;
  placeholder?: string;
  min?: string;
  step?: string;
  onChange: (name: keyof FormState, value: string) => void;
}) {
  return (
    <label className="field">
      <span>
        {label}
        {!required && <small>Optional</small>}
      </span>
      <input
        name={name}
        type={type}
        value={value}
        required={required}
        placeholder={placeholder}
        min={min}
        step={step}
        onChange={(event) => onChange(name, event.target.value)}
      />
    </label>
  );
}

function OrderRow({ order }: { order: Order }) {
  return (
    <article className="order-row">
      <div className="medication-mark" aria-hidden="true">
        {order.prescription.medicationName.slice(0, 1).toUpperCase()}
      </div>
      <div className="order-main">
        <div className="order-heading">
          <strong>{order.prescription.medicationName}</strong>
          <span className={`risk-badge risk-${order.riskLevel}`}>
            {order.riskLevel} risk
          </span>
        </div>
        <p>
          {order.prescription.doseMg} mg ·{" "}
          {order.prescription.frequencyPerDay}× daily · Qty{" "}
          {order.prescription.quantity}
        </p>
        <div className="order-meta">
          <span>Patient {order.patient.id}</span>
          <span>Prescriber {order.prescriber.name}</span>
          <span>{formatDate(order.createdAt)}</span>
        </div>
      </div>
      <span className="accepted-status">Accepted</span>
    </article>
  );
}

export default function App() {
  const [form, setForm] = useState(initialForm);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  const loadOrders = useCallback(async (signal?: AbortSignal) => {
    try {
      const result = await listOrders(signal);
      setOrders(result.items);
    } catch (error) {
      if (signal?.aborted) {
        return;
      }
      setNotice({
        tone: "error",
        message:
          error instanceof Error
            ? error.message
            : "Orders could not be loaded.",
      });
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void listOrders(controller.signal)
      .then((result) => {
        setOrders(result.items);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setNotice({
            tone: "error",
            message:
              error instanceof Error
                ? error.message
                : "Orders could not be loaded.",
          });
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, []);

  function updateField(name: keyof FormState, value: string): void {
    setForm((current) => ({ ...current, [name]: value }));
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setNotice(null);
    try {
      const order = await createOrder(asRequest(form));
      setOrders((current) => [order, ...current]);
      setForm(initialForm);
      setNotice({
        tone: "success",
        message: "Prescription accepted after medication safety review.",
        reference: `Order ${order.id}`,
      });
    } catch (error) {
      const apiError =
        error instanceof PharmacyApiError ? error : undefined;
      setNotice({
        tone: "error",
        message:
          error instanceof Error
            ? error.message
            : "The prescription could not be submitted.",
        ...(apiError?.correlationId === undefined
          ? {}
          : { reference: `Reference ${apiError.correlationId}` }),
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Caldova Pharmacy home">
          <span className="brand-symbol" aria-hidden="true">
            <span />
            <span />
          </span>
          <span>
            <strong>Caldova</strong>
            <small>Pharmacy Operations</small>
          </span>
        </a>
        <div className="environment">
          <span className="environment-dot" />
          Pharmacy services online
        </div>
      </header>

      <main>
        <section className="page-intro">
          <div>
            <p className="eyebrow">Prescription workflow</p>
            <h1>Medication orders</h1>
            <p>
              Submit prescriptions for medication safety assessment and
              pharmacy acceptance.
            </p>
          </div>
          <div className="privacy-chip">
            <span aria-hidden="true">◆</span>
            Secure clinical workspace
          </div>
        </section>

        {notice !== null && (
          <div className={`notice notice-${notice.tone}`} role="status">
            <span className="notice-icon" aria-hidden="true">
              {notice.tone === "success" ? "✓" : "!"}
            </span>
            <div>
              <strong>
                {notice.tone === "success"
                  ? "Order processed"
                  : "Action required"}
              </strong>
              <p>{notice.message}</p>
              {notice.reference !== undefined && (
                <small>{notice.reference}</small>
              )}
            </div>
            <button
              type="button"
              aria-label="Dismiss notification"
              onClick={() => setNotice(null)}
            >
              ×
            </button>
          </div>
        )}

        <div className="workspace-grid">
          <section className="panel order-form-panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">New prescription</p>
                <h2>Order details</h2>
              </div>
              <span className="step-badge">Safety checked</span>
            </div>

            <form onSubmit={(event) => void submit(event)}>
              <fieldset>
                <legend>
                  <span>1</span> Patient
                </legend>
                <div className="field-grid">
                  <Field
                    label="Patient identifier"
                    name="patientId"
                    value={form.patientId}
                    placeholder="Patient ID"
                    onChange={updateField}
                  />
                  <Field
                    label="Date of birth"
                    name="dateOfBirth"
                    type="date"
                    value={form.dateOfBirth}
                    onChange={updateField}
                  />
                  <Field
                    label="Known allergies"
                    name="allergies"
                    value={form.allergies}
                    required={false}
                    placeholder="Comma-separated medications"
                    onChange={updateField}
                  />
                  <Field
                    label="Current medications"
                    name="currentMedications"
                    value={form.currentMedications}
                    required={false}
                    placeholder="Comma-separated medications"
                    onChange={updateField}
                  />
                </div>
              </fieldset>

              <fieldset>
                <legend>
                  <span>2</span> Prescription
                </legend>
                <div className="field-grid">
                  <Field
                    label="Medication"
                    name="medicationName"
                    value={form.medicationName}
                    placeholder="Generic medication name"
                    onChange={updateField}
                  />
                  <Field
                    label="RxNorm code"
                    name="rxNormCode"
                    value={form.rxNormCode}
                    required={false}
                    placeholder="Normalized identifier"
                    onChange={updateField}
                  />
                  <Field
                    label="Strength (mg)"
                    name="strengthMg"
                    type="number"
                    value={form.strengthMg}
                    min="0.001"
                    step="0.001"
                    onChange={updateField}
                  />
                  <Field
                    label="Dose (mg)"
                    name="doseMg"
                    type="number"
                    value={form.doseMg}
                    min="0.001"
                    step="0.001"
                    onChange={updateField}
                  />
                  <Field
                    label="Times per day"
                    name="frequencyPerDay"
                    type="number"
                    value={form.frequencyPerDay}
                    min="1"
                    step="1"
                    onChange={updateField}
                  />
                  <Field
                    label="Quantity"
                    name="quantity"
                    type="number"
                    value={form.quantity}
                    min="1"
                    step="1"
                    onChange={updateField}
                  />
                </div>
              </fieldset>

              <fieldset>
                <legend>
                  <span>3</span> Prescriber
                </legend>
                <div className="field-grid">
                  <Field
                    label="Prescriber identifier"
                    name="prescriberId"
                    value={form.prescriberId}
                    placeholder="NPI or internal ID"
                    onChange={updateField}
                  />
                  <Field
                    label="Prescriber name"
                    name="prescriberName"
                    value={form.prescriberName}
                    placeholder="Full name"
                    onChange={updateField}
                  />
                </div>
              </fieldset>

              <div className="form-actions">
                <p>
                  Submitting requests an automated medication safety
                  assessment before acceptance.
                </p>
                <button className="primary-button" disabled={submitting}>
                  {submitting ? "Reviewing…" : "Review and submit"}
                  <span aria-hidden="true">→</span>
                </button>
              </div>
            </form>
          </section>

          <aside className="panel activity-panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Live activity</p>
                <h2>Recent orders</h2>
              </div>
              <button
                className="refresh-button"
                type="button"
                onClick={() => {
                  setLoading(true);
                  void loadOrders();
                }}
                disabled={loading}
              >
                Refresh
              </button>
            </div>

            <div className="order-list" aria-live="polite">
              {loading ? (
                <div className="empty-state">
                  <span className="loading-ring" />
                  <h3>Loading orders</h3>
                  <p>Retrieving the latest pharmacy activity.</p>
                </div>
              ) : orders.length === 0 ? (
                <div className="empty-state">
                  <span className="empty-icon" aria-hidden="true">
                    +
                  </span>
                  <h3>No accepted orders</h3>
                  <p>Accepted prescriptions will appear here.</p>
                </div>
              ) : (
                orders.map((order) => (
                  <OrderRow key={order.id} order={order} />
                ))
              )}
            </div>
          </aside>
        </div>
      </main>

      <footer>
        <span>Caldova Pharmacy Platform</span>
        <span>
          Medication safety support does not replace professional clinical
          judgment.
        </span>
      </footer>
    </div>
  );
}
