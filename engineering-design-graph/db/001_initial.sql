CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE artifact_status AS ENUM ('draft','review','approved','locked','changed','outdated','deprecated');
CREATE TYPE knowledge_state AS ENUM ('known','assumed','proposed','undefined');

CREATE TABLE projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  revision bigint NOT NULL DEFAULT 0,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  key text NOT NULL,
  type text NOT NULL,
  title text NOT NULL,
  description text,
  status artifact_status NOT NULL DEFAULT 'draft',
  knowledge_state knowledge_state NOT NULL DEFAULT 'known',
  current_version int NOT NULL DEFAULT 1,
  current_version_id uuid,
  owner_user_id uuid,
  tags text[] NOT NULL DEFAULT '{}',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  revision bigint NOT NULL DEFAULT 0,
  review_required boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  UNIQUE(project_id, key)
);

CREATE TABLE artifact_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  artifact_id uuid NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  version int NOT NULL,
  schema_version int NOT NULL DEFAULT 1,
  title text NOT NULL,
  description text,
  payload jsonb NOT NULL,
  knowledge_annotations jsonb NOT NULL DEFAULT '[]'::jsonb,
  change_set_id uuid,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(artifact_id, version)
);
ALTER TABLE artifacts ADD CONSTRAINT artifacts_current_version_fk FOREIGN KEY (current_version_id) REFERENCES artifact_versions(id);

CREATE TABLE relations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  from_artifact_id uuid NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  to_artifact_id uuid NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  type text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  source text NOT NULL DEFAULT 'human',
  confidence numeric(4,3),
  rationale text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (from_artifact_id <> to_artifact_id)
);
CREATE INDEX idx_relations_from ON relations(project_id, from_artifact_id, type);
CREATE INDEX idx_relations_to ON relations(project_id, to_artifact_id, type);

CREATE TABLE change_sets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'open',
  base_revision bigint NOT NULL,
  actor_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE change_set_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  change_set_id uuid NOT NULL REFERENCES change_sets(id) ON DELETE CASCADE,
  operation text NOT NULL,
  target_id uuid,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE artifact_versions ADD CONSTRAINT artifact_versions_changeset_fk FOREIGN KEY (change_set_id) REFERENCES change_sets(id);

CREATE TABLE validation_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  rule_id text NOT NULL,
  severity text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  title text NOT NULL,
  message text NOT NULL,
  artifact_ids uuid[] NOT NULL DEFAULT '{}',
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  suggested_fix text,
  fingerprint text NOT NULL,
  first_detected_at timestamptz NOT NULL DEFAULT now(),
  last_detected_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  UNIQUE(project_id, fingerprint)
);
CREATE INDEX idx_validation_open ON validation_issues(project_id, status, severity);

CREATE TABLE ai_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  request_id uuid,
  operation text NOT NULL,
  target_artifact_id uuid REFERENCES artifacts(id),
  proposed_type text,
  proposed_payload jsonb NOT NULL,
  provenance jsonb NOT NULL,
  confidence numeric(4,3) CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE TABLE reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  artifact_id uuid REFERENCES artifacts(id) ON DELETE CASCADE,
  change_set_id uuid REFERENCES change_sets(id) ON DELETE CASCADE,
  reviewer_user_id uuid NOT NULL,
  state text NOT NULL,
  comment text,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  CHECK (artifact_id IS NOT NULL OR change_set_id IS NOT NULL)
);

CREATE TABLE readiness_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  stage text NOT NULL,
  status text NOT NULL,
  score numeric(5,2) NOT NULL,
  result jsonb NOT NULL,
  artifact_version_ids uuid[] NOT NULL,
  validation_issue_ids uuid[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_logs (
  id bigserial PRIMARY KEY,
  project_id uuid,
  actor_user_id uuid,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  trace_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE outbox_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aggregate_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz
);
