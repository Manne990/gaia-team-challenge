ALTER TABLE companies ADD COLUMN archived_at TEXT;

CREATE INDEX companies_org_active_updated_idx
ON companies (organization_id, archived_at, updated_at DESC, id);
