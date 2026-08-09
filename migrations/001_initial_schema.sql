CREATE TABLE organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0)
);

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0)
);

CREATE TABLE memberships (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'member', 'viewer')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (organization_id, user_id)
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE companies (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  external_reference TEXT,
  website TEXT,
  phone TEXT,
  industry TEXT,
  size TEXT,
  address TEXT,
  lifecycle_status TEXT NOT NULL DEFAULT 'lead' CHECK (lifecycle_status IN ('lead', 'prospect', 'customer', 'inactive')),
  owner_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  tags_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(tags_json)),
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, external_reference)
);

CREATE TABLE contacts (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  company_id TEXT,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  job_title TEXT,
  owner_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'lead')),
  tags_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(tags_json)),
  communication_preference TEXT NOT NULL DEFAULT 'email' CHECK (communication_preference IN ('email', 'phone', 'none')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, company_id) REFERENCES companies(organization_id, id)
);

CREATE TABLE pipeline_stages (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position >= 0),
  kind TEXT NOT NULL DEFAULT 'open' CHECK (kind IN ('open', 'won', 'lost')),
  created_at TEXT NOT NULL,
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, name),
  UNIQUE (organization_id, position)
);

CREATE TABLE deals (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  company_id TEXT NOT NULL,
  owner_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  stage_id TEXT NOT NULL,
  name TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  currency TEXT NOT NULL DEFAULT 'USD' CHECK (length(currency) = 3),
  expected_close_date TEXT,
  probability INTEGER NOT NULL DEFAULT 0 CHECK (probability BETWEEN 0 AND 100),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'won', 'lost')),
  loss_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, company_id) REFERENCES companies(organization_id, id),
  FOREIGN KEY (organization_id, stage_id) REFERENCES pipeline_stages(organization_id, id)
);

CREATE TABLE deal_contacts (
  deal_id TEXT NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  PRIMARY KEY (deal_id, contact_id),
  FOREIGN KEY (organization_id, deal_id) REFERENCES deals(organization_id, id),
  FOREIGN KEY (organization_id, contact_id) REFERENCES contacts(organization_id, id)
);

CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  assignee_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  due_at TEXT,
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'completed', 'cancelled')),
  company_id TEXT,
  contact_id TEXT,
  deal_id TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, company_id) REFERENCES companies(organization_id, id),
  FOREIGN KEY (organization_id, contact_id) REFERENCES contacts(organization_id, id),
  FOREIGN KEY (organization_id, deal_id) REFERENCES deals(organization_id, id)
);

CREATE TABLE activities (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('call', 'email', 'meeting', 'note', 'status_change')),
  subject TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  occurred_at TEXT NOT NULL,
  creator_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  company_id TEXT,
  contact_id TEXT,
  deal_id TEXT,
  task_id TEXT,
  participant_names_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(participant_names_json)),
  creator_name_snapshot TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, company_id) REFERENCES companies(organization_id, id),
  FOREIGN KEY (organization_id, contact_id) REFERENCES contacts(organization_id, id),
  FOREIGN KEY (organization_id, deal_id) REFERENCES deals(organization_id, id),
  FOREIGN KEY (organization_id, task_id) REFERENCES tasks(organization_id, id)
);

CREATE TABLE deal_stage_history (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  deal_id TEXT NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  from_stage_id TEXT,
  to_stage_id TEXT NOT NULL,
  actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  changed_at TEXT NOT NULL,
  reason TEXT,
  FOREIGN KEY (organization_id, deal_id) REFERENCES deals(organization_id, id),
  FOREIGN KEY (organization_id, to_stage_id) REFERENCES pipeline_stages(organization_id, id)
);

CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('task_assigned', 'task_due', 'task_overdue', 'deal_changed')),
  dedupe_key TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  created_at TEXT NOT NULL,
  read_at TEXT,
  UNIQUE (organization_id, user_id, dedupe_key)
);

CREATE TABLE saved_views (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  resource TEXT NOT NULL CHECK (resource IN ('companies', 'contacts', 'activities', 'deals', 'tasks')),
  name TEXT NOT NULL,
  filters_json TEXT NOT NULL CHECK (json_valid(filters_json)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (organization_id, user_id, resource, name)
);

CREATE TABLE imports (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_by_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  resource TEXT NOT NULL CHECK (resource IN ('companies', 'contacts')),
  status TEXT NOT NULL CHECK (status IN ('preview', 'committed', 'failed')),
  mapping_json TEXT NOT NULL CHECK (json_valid(mapping_json)),
  result_json TEXT NOT NULL CHECK (json_valid(result_json)),
  created_at TEXT NOT NULL,
  committed_at TEXT
);

CREATE TABLE merge_redirects (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  resource TEXT NOT NULL CHECK (resource IN ('companies', 'contacts')),
  source_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  created_by_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  CHECK (source_id <> target_id),
  UNIQUE (organization_id, resource, source_id)
);

CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  summary_json TEXT NOT NULL CHECK (json_valid(summary_json)),
  created_at TEXT NOT NULL
);

-- Users may only be attached to records inside an organization they belong to.
CREATE TRIGGER sessions_membership_guard BEFORE INSERT ON sessions FOR EACH ROW BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM memberships WHERE organization_id = NEW.organization_id AND user_id = NEW.user_id) THEN RAISE(ABORT, 'session user is not an organization member') END;
END;
CREATE TRIGGER sessions_membership_update_guard BEFORE UPDATE OF organization_id, user_id ON sessions FOR EACH ROW BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM memberships WHERE organization_id = NEW.organization_id AND user_id = NEW.user_id) THEN RAISE(ABORT, 'session user is not an organization member') END;
END;
CREATE TRIGGER companies_owner_guard BEFORE INSERT ON companies FOR EACH ROW WHEN NEW.owner_id IS NOT NULL BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM memberships WHERE organization_id = NEW.organization_id AND user_id = NEW.owner_id) THEN RAISE(ABORT, 'company owner is not an organization member') END;
END;
CREATE TRIGGER companies_owner_update_guard BEFORE UPDATE OF organization_id, owner_id ON companies FOR EACH ROW WHEN NEW.owner_id IS NOT NULL BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM memberships WHERE organization_id = NEW.organization_id AND user_id = NEW.owner_id) THEN RAISE(ABORT, 'company owner is not an organization member') END;
END;
CREATE TRIGGER contacts_owner_guard BEFORE INSERT ON contacts FOR EACH ROW WHEN NEW.owner_id IS NOT NULL BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM memberships WHERE organization_id = NEW.organization_id AND user_id = NEW.owner_id) THEN RAISE(ABORT, 'contact owner is not an organization member') END;
END;
CREATE TRIGGER contacts_owner_update_guard BEFORE UPDATE OF organization_id, owner_id ON contacts FOR EACH ROW WHEN NEW.owner_id IS NOT NULL BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM memberships WHERE organization_id = NEW.organization_id AND user_id = NEW.owner_id) THEN RAISE(ABORT, 'contact owner is not an organization member') END;
END;
CREATE TRIGGER deals_owner_guard BEFORE INSERT ON deals FOR EACH ROW WHEN NEW.owner_id IS NOT NULL BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM memberships WHERE organization_id = NEW.organization_id AND user_id = NEW.owner_id) THEN RAISE(ABORT, 'deal owner is not an organization member') END;
END;
CREATE TRIGGER deals_owner_update_guard BEFORE UPDATE OF organization_id, owner_id ON deals FOR EACH ROW WHEN NEW.owner_id IS NOT NULL BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM memberships WHERE organization_id = NEW.organization_id AND user_id = NEW.owner_id) THEN RAISE(ABORT, 'deal owner is not an organization member') END;
END;
CREATE TRIGGER tasks_assignee_guard BEFORE INSERT ON tasks FOR EACH ROW WHEN NEW.assignee_id IS NOT NULL BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM memberships WHERE organization_id = NEW.organization_id AND user_id = NEW.assignee_id) THEN RAISE(ABORT, 'task assignee is not an organization member') END;
END;
CREATE TRIGGER tasks_assignee_update_guard BEFORE UPDATE OF organization_id, assignee_id ON tasks FOR EACH ROW WHEN NEW.assignee_id IS NOT NULL BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM memberships WHERE organization_id = NEW.organization_id AND user_id = NEW.assignee_id) THEN RAISE(ABORT, 'task assignee is not an organization member') END;
END;
CREATE TRIGGER activities_creator_guard BEFORE INSERT ON activities FOR EACH ROW WHEN NEW.creator_id IS NOT NULL BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM memberships WHERE organization_id = NEW.organization_id AND user_id = NEW.creator_id) THEN RAISE(ABORT, 'activity creator is not an organization member') END;
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
CREATE TRIGGER audit_events_actor_guard BEFORE INSERT ON audit_events FOR EACH ROW WHEN NEW.actor_id IS NOT NULL BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM memberships WHERE organization_id = NEW.organization_id AND user_id = NEW.actor_id) THEN RAISE(ABORT, 'audit actor is not an organization member') END;
END;
CREATE TRIGGER audit_events_immutable_update BEFORE UPDATE ON audit_events FOR EACH ROW BEGIN SELECT RAISE(ABORT, 'audit events are immutable'); END;
CREATE TRIGGER audit_events_immutable_delete BEFORE DELETE ON audit_events FOR EACH ROW BEGIN SELECT RAISE(ABORT, 'audit events are immutable'); END;

CREATE INDEX companies_org_name_idx ON companies(organization_id, name);
CREATE INDEX contacts_org_name_idx ON contacts(organization_id, last_name, first_name);
CREATE INDEX tasks_org_due_idx ON tasks(organization_id, due_at, status);
CREATE INDEX activities_org_occurred_idx ON activities(organization_id, occurred_at DESC);
CREATE INDEX deals_org_stage_idx ON deals(organization_id, stage_id, status);
CREATE INDEX audit_events_org_created_idx ON audit_events(organization_id, created_at DESC);
