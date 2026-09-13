CREATE TABLE idempotency_records (
  scope text PRIMARY KEY,
  fingerprint text NOT NULL,
  state text NOT NULL CHECK (state IN ('pending','completed')),
  response jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX idx_idempotency_records_expires ON idempotency_records(expires_at);
