ALTER TABLE tasks ADD COLUMN archived_at TEXT;
CREATE INDEX tasks_org_archived_due_idx
  ON tasks (organization_id, archived_at, status, due_at, id);
