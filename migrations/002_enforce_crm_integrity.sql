-- Forward-only integrity hardening for databases that already applied 001.
CREATE TRIGGER sessions_membership_update_guard BEFORE UPDATE OF organization_id, user_id ON sessions FOR EACH ROW BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM memberships WHERE organization_id = NEW.organization_id AND user_id = NEW.user_id) THEN RAISE(ABORT, 'session user is not an organization member') END;
END;
CREATE TRIGGER deals_stage_status_guard BEFORE INSERT ON deals FOR EACH ROW BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM pipeline_stages WHERE organization_id = NEW.organization_id AND id = NEW.stage_id AND kind = NEW.status) THEN RAISE(ABORT, 'deal status must match pipeline stage kind') END;
END;
CREATE TRIGGER deals_stage_status_update_guard BEFORE UPDATE OF organization_id, stage_id, status ON deals FOR EACH ROW BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM pipeline_stages WHERE organization_id = NEW.organization_id AND id = NEW.stage_id AND kind = NEW.status) THEN RAISE(ABORT, 'deal status must match pipeline stage kind') END;
END;
CREATE TRIGGER pipeline_stages_deal_status_guard BEFORE UPDATE OF kind ON pipeline_stages FOR EACH ROW BEGIN
  SELECT CASE WHEN EXISTS (SELECT 1 FROM deals WHERE organization_id = OLD.organization_id AND stage_id = OLD.id AND status <> NEW.kind) THEN RAISE(ABORT, 'stage kind must match deals already in stage') END;
END;
CREATE TRIGGER tasks_completion_guard BEFORE INSERT ON tasks FOR EACH ROW BEGIN
  SELECT CASE WHEN (NEW.status = 'completed' AND NEW.completed_at IS NULL) OR (NEW.status <> 'completed' AND NEW.completed_at IS NOT NULL) THEN RAISE(ABORT, 'task completion timestamp must match status') END;
END;
CREATE TRIGGER tasks_completion_update_guard BEFORE UPDATE OF status, completed_at ON tasks FOR EACH ROW BEGIN
  SELECT CASE WHEN (NEW.status = 'completed' AND NEW.completed_at IS NULL) OR (NEW.status <> 'completed' AND NEW.completed_at IS NOT NULL) THEN RAISE(ABORT, 'task completion timestamp must match status') END;
END;
CREATE TRIGGER deal_history_from_stage_guard BEFORE INSERT ON deal_stage_history FOR EACH ROW WHEN NEW.from_stage_id IS NOT NULL BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM pipeline_stages WHERE organization_id = NEW.organization_id AND id = NEW.from_stage_id) THEN RAISE(ABORT, 'history source stage must stay in organization') END;
END;
CREATE TRIGGER deal_history_from_stage_update_guard BEFORE UPDATE OF organization_id, from_stage_id ON deal_stage_history FOR EACH ROW WHEN NEW.from_stage_id IS NOT NULL BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM pipeline_stages WHERE organization_id = NEW.organization_id AND id = NEW.from_stage_id) THEN RAISE(ABORT, 'history source stage must stay in organization') END;
END;
CREATE TRIGGER activities_creator_update_guard BEFORE UPDATE OF organization_id, creator_id ON activities FOR EACH ROW WHEN NEW.creator_id IS NOT NULL BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM memberships WHERE organization_id = NEW.organization_id AND user_id = NEW.creator_id) THEN RAISE(ABORT, 'activity creator is not an organization member') END;
END;
CREATE TRIGGER deal_stage_history_actor_guard BEFORE INSERT ON deal_stage_history FOR EACH ROW WHEN NEW.actor_id IS NOT NULL BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM memberships WHERE organization_id = NEW.organization_id AND user_id = NEW.actor_id) THEN RAISE(ABORT, 'deal history actor is not an organization member') END;
END;
CREATE TRIGGER deal_stage_history_actor_update_guard BEFORE UPDATE OF organization_id, actor_id ON deal_stage_history FOR EACH ROW WHEN NEW.actor_id IS NOT NULL BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM memberships WHERE organization_id = NEW.organization_id AND user_id = NEW.actor_id) THEN RAISE(ABORT, 'deal history actor is not an organization member') END;
END;
CREATE TRIGGER notifications_user_guard BEFORE INSERT ON notifications FOR EACH ROW BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM memberships WHERE organization_id = NEW.organization_id AND user_id = NEW.user_id) THEN RAISE(ABORT, 'notification user is not an organization member') END;
END;
CREATE TRIGGER notifications_user_update_guard BEFORE UPDATE OF organization_id, user_id ON notifications FOR EACH ROW BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM memberships WHERE organization_id = NEW.organization_id AND user_id = NEW.user_id) THEN RAISE(ABORT, 'notification user is not an organization member') END;
END;
CREATE TRIGGER saved_views_membership_guard BEFORE INSERT ON saved_views FOR EACH ROW BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM memberships WHERE organization_id = NEW.organization_id AND user_id = NEW.user_id) THEN RAISE(ABORT, 'saved view user is not an organization member') END;
END;
CREATE TRIGGER saved_views_membership_update_guard BEFORE UPDATE OF organization_id, user_id ON saved_views FOR EACH ROW BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM memberships WHERE organization_id = NEW.organization_id AND user_id = NEW.user_id) THEN RAISE(ABORT, 'saved view user is not an organization member') END;
END;
CREATE TRIGGER imports_creator_guard BEFORE INSERT ON imports FOR EACH ROW WHEN NEW.created_by_id IS NOT NULL BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM memberships WHERE organization_id = NEW.organization_id AND user_id = NEW.created_by_id) THEN RAISE(ABORT, 'import creator is not an organization member') END;
END;
CREATE TRIGGER imports_creator_update_guard BEFORE UPDATE OF organization_id, created_by_id ON imports FOR EACH ROW WHEN NEW.created_by_id IS NOT NULL BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM memberships WHERE organization_id = NEW.organization_id AND user_id = NEW.created_by_id) THEN RAISE(ABORT, 'import creator is not an organization member') END;
END;
CREATE TRIGGER merge_redirects_creator_guard BEFORE INSERT ON merge_redirects FOR EACH ROW WHEN NEW.created_by_id IS NOT NULL BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM memberships WHERE organization_id = NEW.organization_id AND user_id = NEW.created_by_id) THEN RAISE(ABORT, 'merge creator is not an organization member') END;
END;
CREATE TRIGGER merge_redirects_creator_update_guard BEFORE UPDATE OF organization_id, created_by_id ON merge_redirects FOR EACH ROW WHEN NEW.created_by_id IS NOT NULL BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM memberships WHERE organization_id = NEW.organization_id AND user_id = NEW.created_by_id) THEN RAISE(ABORT, 'merge creator is not an organization member') END;
END;
CREATE TRIGGER merge_redirects_target_guard BEFORE INSERT ON merge_redirects FOR EACH ROW BEGIN
  SELECT CASE WHEN NEW.resource = 'companies' AND (NOT EXISTS (SELECT 1 FROM companies WHERE organization_id = NEW.organization_id AND id = NEW.source_id) OR NOT EXISTS (SELECT 1 FROM companies WHERE organization_id = NEW.organization_id AND id = NEW.target_id)) THEN RAISE(ABORT, 'company merge redirect must stay in organization') END;
  SELECT CASE WHEN NEW.resource = 'contacts' AND (NOT EXISTS (SELECT 1 FROM contacts WHERE organization_id = NEW.organization_id AND id = NEW.source_id) OR NOT EXISTS (SELECT 1 FROM contacts WHERE organization_id = NEW.organization_id AND id = NEW.target_id)) THEN RAISE(ABORT, 'contact merge redirect must stay in organization') END;
END;
CREATE TRIGGER merge_redirects_target_update_guard BEFORE UPDATE OF organization_id, resource, source_id, target_id ON merge_redirects FOR EACH ROW BEGIN
  SELECT CASE WHEN NEW.resource = 'companies' AND (NOT EXISTS (SELECT 1 FROM companies WHERE organization_id = NEW.organization_id AND id = NEW.source_id) OR NOT EXISTS (SELECT 1 FROM companies WHERE organization_id = NEW.organization_id AND id = NEW.target_id)) THEN RAISE(ABORT, 'company merge redirect must stay in organization') END;
  SELECT CASE WHEN NEW.resource = 'contacts' AND (NOT EXISTS (SELECT 1 FROM contacts WHERE organization_id = NEW.organization_id AND id = NEW.source_id) OR NOT EXISTS (SELECT 1 FROM contacts WHERE organization_id = NEW.organization_id AND id = NEW.target_id)) THEN RAISE(ABORT, 'contact merge redirect must stay in organization') END;
END;
CREATE TRIGGER companies_merge_redirect_delete_guard BEFORE DELETE ON companies FOR EACH ROW BEGIN
  SELECT CASE WHEN EXISTS (SELECT 1 FROM merge_redirects WHERE organization_id = OLD.organization_id AND resource = 'companies' AND (source_id = OLD.id OR target_id = OLD.id)) THEN RAISE(ABORT, 'remove company merge redirects before deleting endpoint') END;
END;
CREATE TRIGGER contacts_merge_redirect_delete_guard BEFORE DELETE ON contacts FOR EACH ROW BEGIN
  SELECT CASE WHEN EXISTS (SELECT 1 FROM merge_redirects WHERE organization_id = OLD.organization_id AND resource = 'contacts' AND (source_id = OLD.id OR target_id = OLD.id)) THEN RAISE(ABORT, 'remove contact merge redirects before deleting endpoint') END;
END;
CREATE TRIGGER audit_events_actor_guard BEFORE INSERT ON audit_events FOR EACH ROW WHEN NEW.actor_id IS NOT NULL BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM memberships WHERE organization_id = NEW.organization_id AND user_id = NEW.actor_id) THEN RAISE(ABORT, 'audit actor is not an organization member') END;
END;
CREATE TRIGGER memberships_references_guard BEFORE DELETE ON memberships FOR EACH ROW BEGIN
  SELECT CASE WHEN EXISTS (SELECT 1 FROM sessions WHERE organization_id = OLD.organization_id AND user_id = OLD.user_id AND revoked_at IS NULL) THEN RAISE(ABORT, 'revoke active sessions before removing membership') END;
  SELECT CASE WHEN EXISTS (SELECT 1 FROM companies WHERE organization_id = OLD.organization_id AND owner_id = OLD.user_id) THEN RAISE(ABORT, 'reassign company ownership before removing membership') END;
  SELECT CASE WHEN EXISTS (SELECT 1 FROM contacts WHERE organization_id = OLD.organization_id AND owner_id = OLD.user_id) THEN RAISE(ABORT, 'reassign contact ownership before removing membership') END;
  SELECT CASE WHEN EXISTS (SELECT 1 FROM deals WHERE organization_id = OLD.organization_id AND owner_id = OLD.user_id) THEN RAISE(ABORT, 'reassign deal ownership before removing membership') END;
  SELECT CASE WHEN EXISTS (SELECT 1 FROM tasks WHERE organization_id = OLD.organization_id AND assignee_id = OLD.user_id AND status NOT IN ('completed', 'cancelled')) THEN RAISE(ABORT, 'reassign open tasks before removing membership') END;
  SELECT CASE WHEN EXISTS (SELECT 1 FROM notifications WHERE organization_id = OLD.organization_id AND user_id = OLD.user_id AND read_at IS NULL) THEN RAISE(ABORT, 'resolve notifications before removing membership') END;
  SELECT CASE WHEN EXISTS (SELECT 1 FROM saved_views WHERE organization_id = OLD.organization_id AND user_id = OLD.user_id) THEN RAISE(ABORT, 'delete saved views before removing membership') END;
END;
CREATE TRIGGER memberships_tenant_immutable BEFORE UPDATE OF organization_id, user_id ON memberships FOR EACH ROW BEGIN SELECT RAISE(ABORT, 'membership identity is immutable'); END;
CREATE TRIGGER sessions_tenant_immutable BEFORE UPDATE OF organization_id ON sessions FOR EACH ROW BEGIN SELECT RAISE(ABORT, 'session organization is immutable'); END;
CREATE TRIGGER companies_tenant_immutable BEFORE UPDATE OF organization_id ON companies FOR EACH ROW BEGIN SELECT RAISE(ABORT, 'company organization is immutable'); END;
CREATE TRIGGER contacts_tenant_immutable BEFORE UPDATE OF organization_id ON contacts FOR EACH ROW BEGIN SELECT RAISE(ABORT, 'contact organization is immutable'); END;
CREATE TRIGGER pipeline_stages_tenant_immutable BEFORE UPDATE OF organization_id ON pipeline_stages FOR EACH ROW BEGIN SELECT RAISE(ABORT, 'stage organization is immutable'); END;
CREATE TRIGGER deals_tenant_immutable BEFORE UPDATE OF organization_id ON deals FOR EACH ROW BEGIN SELECT RAISE(ABORT, 'deal organization is immutable'); END;
CREATE TRIGGER deal_contacts_tenant_immutable BEFORE UPDATE OF organization_id ON deal_contacts FOR EACH ROW BEGIN SELECT RAISE(ABORT, 'deal contact organization is immutable'); END;
CREATE TRIGGER tasks_tenant_immutable BEFORE UPDATE OF organization_id ON tasks FOR EACH ROW BEGIN SELECT RAISE(ABORT, 'task organization is immutable'); END;
CREATE TRIGGER activities_tenant_immutable BEFORE UPDATE OF organization_id ON activities FOR EACH ROW BEGIN SELECT RAISE(ABORT, 'activity organization is immutable'); END;
CREATE TRIGGER deal_stage_history_tenant_immutable BEFORE UPDATE OF organization_id ON deal_stage_history FOR EACH ROW BEGIN SELECT RAISE(ABORT, 'deal history organization is immutable'); END;
CREATE TRIGGER notifications_tenant_immutable BEFORE UPDATE OF organization_id ON notifications FOR EACH ROW BEGIN SELECT RAISE(ABORT, 'notification organization is immutable'); END;
CREATE TRIGGER saved_views_tenant_immutable BEFORE UPDATE OF organization_id ON saved_views FOR EACH ROW BEGIN SELECT RAISE(ABORT, 'saved view organization is immutable'); END;
CREATE TRIGGER imports_tenant_immutable BEFORE UPDATE OF organization_id ON imports FOR EACH ROW BEGIN SELECT RAISE(ABORT, 'import organization is immutable'); END;
CREATE TRIGGER merge_redirects_tenant_immutable BEFORE UPDATE OF organization_id ON merge_redirects FOR EACH ROW BEGIN SELECT RAISE(ABORT, 'merge redirect organization is immutable'); END;
CREATE TRIGGER audit_events_tenant_immutable BEFORE UPDATE OF organization_id ON audit_events FOR EACH ROW BEGIN SELECT RAISE(ABORT, 'audit event organization is immutable'); END;
