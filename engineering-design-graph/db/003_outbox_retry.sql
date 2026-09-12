ALTER TABLE outbox_events ADD COLUMN attempt_count integer NOT NULL DEFAULT 0;
ALTER TABLE outbox_events ADD COLUMN last_error text;
ALTER TABLE outbox_events ADD COLUMN next_attempt_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE outbox_events ADD COLUMN dead_lettered_at timestamptz;
CREATE INDEX idx_outbox_pending_retry ON outbox_events(next_attempt_at,created_at) WHERE published_at IS NULL AND dead_lettered_at IS NULL;
