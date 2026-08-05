ALTER TABLE tasks ADD COLUMN archived_at TEXT;

CREATE INDEX tasks_operational_view_idx
  ON tasks (organization_id, archived_at, assignee_membership_id, status, due_at, id);
