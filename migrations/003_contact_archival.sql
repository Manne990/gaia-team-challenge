ALTER TABLE contacts ADD COLUMN archived_at TEXT;
CREATE INDEX contacts_org_active_name_idx ON contacts(organization_id, archived_at, last_name, first_name);
