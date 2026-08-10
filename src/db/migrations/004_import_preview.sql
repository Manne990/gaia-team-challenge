ALTER TABLE import_rows ADD COLUMN normalized_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(normalized_json) AND json_type(normalized_json) = 'object');

CREATE INDEX imports_org_created_idx
  ON imports (organization_id, created_at DESC, id);
