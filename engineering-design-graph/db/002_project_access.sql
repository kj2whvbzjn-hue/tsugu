CREATE TABLE project_members (
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_subject text NOT NULL,
  role text NOT NULL CHECK (role IN ('viewer','editor','reviewer','architect','admin')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(project_id,user_subject)
);
CREATE INDEX idx_project_members_subject ON project_members(user_subject,project_id);

CREATE TABLE project_policies (
  project_id uuid PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  policy jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
