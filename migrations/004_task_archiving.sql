ALTER TABLE tasks ADD COLUMN archived_at TEXT;
CREATE INDEX tasks_org_active_due_idx ON tasks(organization_id, archived_at, due_at, status);
