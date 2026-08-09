ALTER TABLE audit_events ADD COLUMN correlation_id TEXT;
UPDATE audit_events SET correlation_id = id WHERE correlation_id IS NULL;
CREATE INDEX audit_events_org_correlation_idx ON audit_events(organization_id, correlation_id);
