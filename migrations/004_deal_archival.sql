ALTER TABLE deals ADD COLUMN archived_at TEXT;
CREATE INDEX deals_org_active_updated_idx ON deals(organization_id, archived_at, updated_at DESC);
