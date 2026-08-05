ALTER TABLE activities ADD COLUMN creator_label_snapshot TEXT NOT NULL DEFAULT '';
ALTER TABLE activities ADD COLUMN company_label_snapshot TEXT;
ALTER TABLE activities ADD COLUMN contact_label_snapshot TEXT;
CREATE INDEX activities_timeline_idx ON activities (organization_id, occurred_at DESC, id DESC);
