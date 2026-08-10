ALTER TABLE audit_events ADD COLUMN correlation_id TEXT;
UPDATE audit_events SET correlation_id = id WHERE correlation_id IS NULL;
CREATE INDEX audit_events_org_correlation_idx ON audit_events(organization_id, correlation_id);
DROP TRIGGER audit_events_immutable_update;
CREATE TRIGGER audit_events_immutable_update BEFORE UPDATE ON audit_events FOR EACH ROW
WHEN NEW.id <> OLD.id OR NEW.organization_id <> OLD.organization_id OR NEW.actor_id IS NOT OLD.actor_id OR NEW.action <> OLD.action OR NEW.entity_type <> OLD.entity_type OR NEW.entity_id <> OLD.entity_id OR NEW.summary_json <> OLD.summary_json OR NEW.created_at <> OLD.created_at OR OLD.correlation_id IS NOT NULL OR NEW.correlation_id IS NULL
BEGIN SELECT RAISE(ABORT, 'audit events are immutable'); END;
CREATE TRIGGER audit_events_correlation_default AFTER INSERT ON audit_events FOR EACH ROW WHEN NEW.correlation_id IS NULL BEGIN
  UPDATE audit_events SET correlation_id = 'cor_' || NEW.id WHERE id = NEW.id;
END;
