CREATE TABLE orders (
  id uuid PRIMARY KEY,
  patient_id varchar(80) NOT NULL,
  patient_date_of_birth date NOT NULL,
  patient_allergies text[] NOT NULL DEFAULT '{}',
  patient_current_medications text[] NOT NULL DEFAULT '{}',
  prescriber_id varchar(80) NOT NULL,
  prescriber_name varchar(200) NOT NULL,
  medication_name varchar(120) NOT NULL,
  rxnorm_code varchar(40),
  strength_mg numeric(12, 3) NOT NULL CHECK (strength_mg > 0),
  dose_mg numeric(12, 3) NOT NULL CHECK (dose_mg > 0),
  frequency_per_day integer NOT NULL CHECK (
    frequency_per_day > 0 AND frequency_per_day <= 24
  ),
  quantity integer NOT NULL CHECK (quantity > 0),
  status text NOT NULL CHECK (status = 'accepted'),
  risk_assessment_id uuid NOT NULL,
  risk_level text NOT NULL CHECK (risk_level IN ('low', 'moderate', 'high')),
  idempotency_key varchar(128) NOT NULL UNIQUE,
  correlation_id varchar(128) NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE INDEX orders_created_at_idx ON orders (created_at DESC, id DESC);
CREATE INDEX orders_patient_id_idx ON orders (patient_id);
CREATE INDEX orders_risk_assessment_id_idx ON orders (risk_assessment_id);
