ALTER TABLE activities ADD COLUMN creator_label TEXT;
ALTER TABLE activities ADD COLUMN company_label TEXT;
ALTER TABLE activities ADD COLUMN contact_label TEXT;
ALTER TABLE activities ADD COLUMN deal_label TEXT;
ALTER TABLE activity_participants ADD COLUMN contact_label TEXT;

UPDATE activities SET creator_label = COALESCE(
  (SELECT u.display_name FROM memberships m JOIN users u ON u.id = m.user_id
   WHERE m.id = activities.creator_membership_id AND m.organization_id = activities.organization_id),
  'Former team member'
);
UPDATE activities SET company_label = (SELECT name FROM companies
  WHERE id = activities.company_id AND organization_id = activities.organization_id);
UPDATE activities SET contact_label = (SELECT trim(first_name || ' ' || last_name) FROM contacts
  WHERE id = activities.contact_id AND organization_id = activities.organization_id);
UPDATE activities SET deal_label = (SELECT name FROM deals
  WHERE id = activities.deal_id AND organization_id = activities.organization_id);
UPDATE activity_participants SET contact_label = (SELECT trim(first_name || ' ' || last_name)
  FROM contacts WHERE id = activity_participants.contact_id
  AND organization_id = activity_participants.organization_id);

CREATE INDEX activities_org_creator_time_idx
  ON activities (organization_id, creator_membership_id, occurred_at DESC, id DESC);
CREATE INDEX activities_org_company_time_idx
  ON activities (organization_id, company_id, occurred_at DESC, id DESC);
CREATE INDEX activities_org_contact_time_idx
  ON activities (organization_id, contact_id, occurred_at DESC, id DESC);
