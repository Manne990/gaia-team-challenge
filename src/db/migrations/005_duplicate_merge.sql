CREATE TABLE entity_aliases (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('company', 'contact')),
  entity_id TEXT NOT NULL,
  source_entity_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  value TEXT NOT NULL,
  normalized_value TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (organization_id, entity_type, entity_id, kind, normalized_value)
) STRICT;

ALTER TABLE merge_redirects ADD COLUMN request_fingerprint TEXT;

CREATE INDEX entity_aliases_lookup_idx
  ON entity_aliases (organization_id, entity_type, normalized_value, entity_id);
CREATE INDEX merge_redirects_target_idx
  ON merge_redirects (organization_id, entity_type, target_id);

CREATE TRIGGER merged_company_cannot_restore
BEFORE UPDATE OF archived_at ON companies
WHEN NEW.archived_at IS NULL AND EXISTS (
  SELECT 1 FROM merge_redirects r WHERE r.organization_id = NEW.organization_id
    AND r.entity_type = 'company' AND r.source_id = NEW.id
)
BEGIN SELECT RAISE(ABORT, 'merged company cannot be restored'); END;

CREATE TRIGGER merged_contact_cannot_restore
BEFORE UPDATE OF archived_at ON contacts
WHEN NEW.archived_at IS NULL AND EXISTS (
  SELECT 1 FROM merge_redirects r WHERE r.organization_id = NEW.organization_id
    AND r.entity_type = 'contact' AND r.source_id = NEW.id
)
BEGIN SELECT RAISE(ABORT, 'merged contact cannot be restored'); END;
