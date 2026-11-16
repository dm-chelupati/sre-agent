CREATE TABLE risk_assessments (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('approved', 'rejected')),
  risk_level text NOT NULL CHECK (risk_level IN ('low', 'moderate', 'high')),
  reasons text[] NOT NULL DEFAULT '{}',
  request_payload jsonb NOT NULL,
  correlation_id varchar(128) NOT NULL,
  assessed_at timestamptz NOT NULL
);

CREATE INDEX risk_assessments_order_id_idx
  ON risk_assessments (order_id);

CREATE INDEX risk_assessments_assessed_at_idx
  ON risk_assessments (assessed_at DESC);
