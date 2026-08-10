ALTER TABLE contacts ADD COLUMN email_normalized TEXT;
ALTER TABLE contacts ADD COLUMN archived_at TEXT;

UPDATE contacts
SET email_normalized = CASE
  WHEN email IS NULL OR length(trim(email)) = 0 THEN NULL
  ELSE lower(trim(email))
END;

CREATE INDEX contacts_org_email_idx
  ON contacts (organization_id, email_normalized)
  WHERE email_normalized IS NOT NULL;
CREATE INDEX contacts_org_active_name_idx
  ON contacts (organization_id, archived_at, last_name, first_name, id);
