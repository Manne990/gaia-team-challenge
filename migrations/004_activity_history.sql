-- Activities retain the facts needed to remain understandable after related
-- CRM records are renamed or archived. Descriptive edits are versioned while
-- identity, relationship, occurrence, and creator facts stay immutable.
ALTER TABLE activities ADD COLUMN company_label_snapshot TEXT;
ALTER TABLE activities ADD COLUMN contact_label_snapshot TEXT;
ALTER TABLE activities ADD COLUMN deal_label_snapshot TEXT;
ALTER TABLE activities ADD COLUMN updated_at TEXT;
ALTER TABLE activities ADD COLUMN version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0);

UPDATE activities SET updated_at = created_at WHERE updated_at IS NULL;

-- Capture labels for records that existed before this migration. Future reads
-- must not depend on mutable company, contact, or deal names.
UPDATE activities
SET company_label_snapshot = (
  SELECT name FROM companies
  WHERE companies.organization_id = activities.organization_id
    AND companies.id = activities.company_id
)
WHERE company_id IS NOT NULL AND company_label_snapshot IS NULL;

UPDATE activities
SET contact_label_snapshot = (
  SELECT first_name || ' ' || last_name FROM contacts
  WHERE contacts.organization_id = activities.organization_id
    AND contacts.id = activities.contact_id
)
WHERE contact_id IS NOT NULL AND contact_label_snapshot IS NULL;

UPDATE activities
SET deal_label_snapshot = (
  SELECT name FROM deals
  WHERE deals.organization_id = activities.organization_id
    AND deals.id = activities.deal_id
)
WHERE deal_id IS NOT NULL AND deal_label_snapshot IS NULL;

CREATE INDEX activities_org_timeline_idx ON activities(organization_id, occurred_at DESC, id DESC);
CREATE INDEX activities_org_creator_idx ON activities(organization_id, creator_id, occurred_at DESC);
CREATE INDEX activities_org_company_idx ON activities(organization_id, company_id, occurred_at DESC);
CREATE INDEX activities_org_contact_idx ON activities(organization_id, contact_id, occurred_at DESC);
