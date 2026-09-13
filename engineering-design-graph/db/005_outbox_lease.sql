ALTER TABLE outbox_events ADD COLUMN lease_owner text;
ALTER TABLE outbox_events ADD COLUMN lease_until timestamptz;
CREATE INDEX idx_outbox_claimable ON outbox_events(next_attempt_at,created_at,id) WHERE published_at IS NULL AND dead_lettered_at IS NULL;
