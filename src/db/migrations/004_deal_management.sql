ALTER TABLE pipeline_stages ADD COLUMN active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1));
ALTER TABLE deals ADD COLUMN archived_at TEXT;

CREATE INDEX pipeline_stages_org_active_position_idx
  ON pipeline_stages (organization_id, active, position, id);
CREATE INDEX deals_org_archived_updated_idx
  ON deals (organization_id, archived_at, updated_at DESC, id);

