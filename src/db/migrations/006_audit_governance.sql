ALTER TABLE audit_events
  ADD COLUMN correlation_id TEXT NOT NULL DEFAULT 'legacy';

CREATE INDEX audit_org_action_time_idx
  ON audit_events (organization_id, action, occurred_at DESC, id DESC);
CREATE INDEX audit_org_entity_time_idx
  ON audit_events (organization_id, entity_type, entity_id, occurred_at DESC, id DESC);
CREATE INDEX audit_org_actor_time_idx
  ON audit_events (organization_id, actor_membership_id, occurred_at DESC, id DESC);

CREATE TRIGGER audit_events_append_only_update
BEFORE UPDATE ON audit_events
BEGIN
  SELECT RAISE(ABORT, 'audit events are append-only');
END;

CREATE TRIGGER audit_events_append_only_delete
BEFORE DELETE ON audit_events
BEGIN
  SELECT RAISE(ABORT, 'audit events are append-only');
END;
