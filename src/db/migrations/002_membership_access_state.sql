ALTER TABLE memberships ADD COLUMN removed_at TEXT;

CREATE INDEX memberships_active_by_organization
  ON memberships (organization_id, role)
  WHERE removed_at IS NULL;
