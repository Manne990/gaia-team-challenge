ALTER TABLE contacts ADD COLUMN archived_at TEXT;

CREATE TABLE contact_history (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  contact_id TEXT NOT NULL,
  actor_membership_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('created', 'updated', 'archived', 'restored')),
  changes_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY (organization_id, contact_id) REFERENCES contacts(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, actor_membership_id) REFERENCES memberships(organization_id, id) ON DELETE RESTRICT,
  UNIQUE (organization_id, id)
);

CREATE INDEX contacts_list_index ON contacts (organization_id, archived_at, last_name, first_name, id);
CREATE INDEX contacts_company_index ON contacts (organization_id, company_id);
CREATE INDEX contact_history_index ON contact_history (organization_id, contact_id, created_at DESC);
