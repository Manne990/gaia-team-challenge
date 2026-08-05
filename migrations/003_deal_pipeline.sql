ALTER TABLE pipeline_stages ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1));
ALTER TABLE deals ADD COLUMN archived_at TEXT;

CREATE TABLE deal_history (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  deal_id TEXT NOT NULL,
  actor_membership_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('created', 'updated', 'transitioned', 'archived', 'restored')),
  from_stage_id TEXT,
  to_stage_id TEXT,
  summary_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (organization_id, deal_id) REFERENCES deals(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, actor_membership_id) REFERENCES memberships(organization_id, id) ON DELETE RESTRICT,
  UNIQUE (organization_id, id)
);

CREATE INDEX deals_active_pipeline_idx ON deals(organization_id, archived_at, stage_id, expected_close_date);
CREATE INDEX deal_history_deal_idx ON deal_history(organization_id, deal_id, created_at DESC);
