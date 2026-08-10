PRAGMA foreign_keys = ON;

CREATE TABLE organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  slug TEXT NOT NULL UNIQUE CHECK (slug = lower(slug)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0)
) STRICT;

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE CHECK (email = lower(email)),
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL CHECK (length(trim(display_name)) > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0)
) STRICT;

CREATE TABLE memberships (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'member', 'viewer')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (organization_id, user_id),
  UNIQUE (id, organization_id),
  UNIQUE (user_id, organization_id)
) STRICT;

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  FOREIGN KEY (user_id, organization_id)
    REFERENCES memberships(user_id, organization_id) ON DELETE CASCADE
) STRICT;

CREATE TABLE pipeline_stages (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  position INTEGER NOT NULL CHECK (position >= 0),
  kind TEXT NOT NULL CHECK (kind IN ('open', 'won', 'lost')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (organization_id, name),
  UNIQUE (organization_id, position),
  UNIQUE (id, organization_id)
) STRICT;

CREATE TABLE companies (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  external_reference TEXT,
  website TEXT,
  phone TEXT,
  industry TEXT,
  size TEXT,
  address TEXT,
  lifecycle_status TEXT NOT NULL CHECK (lifecycle_status IN ('lead', 'prospect', 'customer', 'former_customer')),
  owner_membership_id TEXT,
  tags_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(tags_json) AND json_type(tags_json) = 'array'),
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (id, organization_id),
  UNIQUE (organization_id, external_reference),
  FOREIGN KEY (owner_membership_id, organization_id)
    REFERENCES memberships(id, organization_id)
) STRICT;

CREATE TABLE contacts (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  company_id TEXT,
  first_name TEXT NOT NULL CHECK (length(trim(first_name)) > 0),
  last_name TEXT NOT NULL CHECK (length(trim(last_name)) > 0),
  email TEXT,
  phone TEXT,
  job_title TEXT,
  owner_membership_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('active', 'inactive', 'unqualified')),
  tags_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(tags_json) AND json_type(tags_json) = 'array'),
  communication_preference TEXT NOT NULL CHECK (communication_preference IN ('email', 'phone', 'none')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (id, organization_id),
  FOREIGN KEY (company_id, organization_id) REFERENCES companies(id, organization_id),
  FOREIGN KEY (owner_membership_id, organization_id) REFERENCES memberships(id, organization_id)
) STRICT;

CREATE TABLE deals (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  company_id TEXT NOT NULL,
  owner_membership_id TEXT NOT NULL,
  stage_id TEXT NOT NULL,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0),
  currency TEXT NOT NULL CHECK (length(currency) = 3 AND currency = upper(currency)),
  expected_close_date TEXT,
  probability INTEGER NOT NULL CHECK (probability BETWEEN 0 AND 100),
  status TEXT NOT NULL CHECK (status IN ('open', 'won', 'lost')),
  loss_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (id, organization_id),
  FOREIGN KEY (company_id, organization_id) REFERENCES companies(id, organization_id),
  FOREIGN KEY (owner_membership_id, organization_id) REFERENCES memberships(id, organization_id),
  FOREIGN KEY (stage_id, organization_id) REFERENCES pipeline_stages(id, organization_id),
  CHECK ((status = 'lost' AND length(trim(loss_reason)) > 0) OR (status != 'lost' AND loss_reason IS NULL))
) STRICT;

CREATE TABLE deal_contacts (
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  deal_id TEXT NOT NULL,
  contact_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (deal_id, contact_id),
  FOREIGN KEY (deal_id, organization_id) REFERENCES deals(id, organization_id) ON DELETE CASCADE,
  FOREIGN KEY (contact_id, organization_id) REFERENCES contacts(id, organization_id) ON DELETE CASCADE
) STRICT;

CREATE TABLE deal_stage_history (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  deal_id TEXT NOT NULL,
  from_stage_id TEXT,
  to_stage_id TEXT NOT NULL,
  changed_by_membership_id TEXT NOT NULL,
  changed_at TEXT NOT NULL,
  FOREIGN KEY (deal_id, organization_id) REFERENCES deals(id, organization_id) ON DELETE CASCADE,
  FOREIGN KEY (from_stage_id, organization_id) REFERENCES pipeline_stages(id, organization_id),
  FOREIGN KEY (to_stage_id, organization_id) REFERENCES pipeline_stages(id, organization_id),
  FOREIGN KEY (changed_by_membership_id, organization_id) REFERENCES memberships(id, organization_id)
) STRICT;

CREATE TABLE activities (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  creator_membership_id TEXT NOT NULL,
  company_id TEXT,
  contact_id TEXT,
  deal_id TEXT,
  type TEXT NOT NULL CHECK (type IN ('call', 'email', 'meeting', 'note', 'status_change')),
  subject TEXT NOT NULL CHECK (length(trim(subject)) > 0),
  body TEXT NOT NULL DEFAULT '',
  occurred_at TEXT NOT NULL,
  follow_up_task_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (id, organization_id),
  FOREIGN KEY (creator_membership_id, organization_id) REFERENCES memberships(id, organization_id),
  FOREIGN KEY (company_id, organization_id) REFERENCES companies(id, organization_id),
  FOREIGN KEY (contact_id, organization_id) REFERENCES contacts(id, organization_id),
  FOREIGN KEY (deal_id, organization_id) REFERENCES deals(id, organization_id),
  FOREIGN KEY (follow_up_task_id, organization_id) REFERENCES tasks(id, organization_id)
) STRICT;

CREATE TABLE activity_participants (
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  activity_id TEXT NOT NULL,
  contact_id TEXT NOT NULL,
  PRIMARY KEY (activity_id, contact_id),
  FOREIGN KEY (activity_id, organization_id) REFERENCES activities(id, organization_id) ON DELETE CASCADE,
  FOREIGN KEY (contact_id, organization_id) REFERENCES contacts(id, organization_id) ON DELETE CASCADE
) STRICT;

CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  assignee_membership_id TEXT NOT NULL,
  company_id TEXT,
  contact_id TEXT,
  deal_id TEXT,
  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
  description TEXT NOT NULL DEFAULT '',
  due_at TEXT NOT NULL,
  priority TEXT NOT NULL CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  status TEXT NOT NULL CHECK (status IN ('open', 'in_progress', 'completed', 'cancelled')),
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (id, organization_id),
  FOREIGN KEY (assignee_membership_id, organization_id) REFERENCES memberships(id, organization_id),
  FOREIGN KEY (company_id, organization_id) REFERENCES companies(id, organization_id),
  FOREIGN KEY (contact_id, organization_id) REFERENCES contacts(id, organization_id),
  FOREIGN KEY (deal_id, organization_id) REFERENCES deals(id, organization_id),
  CHECK ((status = 'completed' AND completed_at IS NOT NULL) OR (status != 'completed' AND completed_at IS NULL))
) STRICT;

CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  recipient_membership_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  dedupe_key TEXT NOT NULL,
  message TEXT NOT NULL,
  read_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (organization_id, recipient_membership_id, dedupe_key),
  FOREIGN KEY (recipient_membership_id, organization_id) REFERENCES memberships(id, organization_id) ON DELETE CASCADE
) STRICT;

CREATE TABLE saved_views (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  owner_membership_id TEXT NOT NULL,
  resource TEXT NOT NULL CHECK (resource IN ('companies', 'contacts', 'activities', 'deals', 'tasks')),
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  state_json TEXT NOT NULL CHECK (json_valid(state_json) AND json_type(state_json) = 'object'),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (organization_id, owner_membership_id, resource, name),
  FOREIGN KEY (owner_membership_id, organization_id) REFERENCES memberships(id, organization_id) ON DELETE CASCADE
) STRICT;

CREATE TABLE imports (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_by_membership_id TEXT NOT NULL,
  resource TEXT NOT NULL CHECK (resource IN ('companies', 'contacts')),
  status TEXT NOT NULL CHECK (status IN ('previewed', 'committed', 'failed')),
  source_name TEXT NOT NULL,
  mapping_json TEXT NOT NULL CHECK (json_valid(mapping_json) AND json_type(mapping_json) = 'object'),
  summary_json TEXT NOT NULL CHECK (json_valid(summary_json) AND json_type(summary_json) = 'object'),
  created_at TEXT NOT NULL,
  committed_at TEXT,
  FOREIGN KEY (created_by_membership_id, organization_id) REFERENCES memberships(id, organization_id)
) STRICT;

CREATE TABLE import_rows (
  id TEXT PRIMARY KEY,
  import_id TEXT NOT NULL REFERENCES imports(id) ON DELETE CASCADE,
  row_number INTEGER NOT NULL CHECK (row_number > 0),
  status TEXT NOT NULL CHECK (status IN ('valid', 'warning', 'error', 'committed')),
  errors_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(errors_json) AND json_type(errors_json) = 'array'),
  UNIQUE (import_id, row_number)
) STRICT;

CREATE TABLE merge_redirects (
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('company', 'contact')),
  source_id TEXT NOT NULL,
  target_id TEXT NOT NULL CHECK (source_id != target_id),
  merged_by_membership_id TEXT NOT NULL,
  merged_at TEXT NOT NULL,
  PRIMARY KEY (organization_id, entity_type, source_id),
  FOREIGN KEY (merged_by_membership_id, organization_id) REFERENCES memberships(id, organization_id)
) STRICT;

CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  actor_membership_id TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  summary_json TEXT NOT NULL CHECK (json_valid(summary_json) AND json_type(summary_json) = 'object'),
  occurred_at TEXT NOT NULL,
  FOREIGN KEY (actor_membership_id, organization_id) REFERENCES memberships(id, organization_id)
) STRICT;

CREATE INDEX companies_org_updated_idx ON companies (organization_id, updated_at DESC, id);
CREATE INDEX contacts_org_name_idx ON contacts (organization_id, last_name, first_name, id);
CREATE INDEX deals_org_stage_idx ON deals (organization_id, stage_id, status, id);
CREATE INDEX activities_org_occurred_idx ON activities (organization_id, occurred_at DESC, id);
CREATE INDEX tasks_org_due_idx ON tasks (organization_id, status, due_at, id);
CREATE INDEX notifications_recipient_idx ON notifications (organization_id, recipient_membership_id, read_at, created_at DESC);
CREATE INDEX audit_org_time_idx ON audit_events (organization_id, occurred_at DESC, id);

-- Added after tasks exists to preserve a typed follow-up relationship.
CREATE TRIGGER activities_follow_up_insert
BEFORE INSERT ON activities WHEN NEW.follow_up_task_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM tasks WHERE id = NEW.follow_up_task_id AND organization_id = NEW.organization_id
  ) THEN RAISE(ABORT, 'follow-up task must belong to activity organization') END;
END;

CREATE TRIGGER activities_follow_up_update
BEFORE UPDATE OF follow_up_task_id, organization_id ON activities WHEN NEW.follow_up_task_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM tasks WHERE id = NEW.follow_up_task_id AND organization_id = NEW.organization_id
  ) THEN RAISE(ABORT, 'follow-up task must belong to activity organization') END;
END;

CREATE TRIGGER merge_redirects_company_insert
BEFORE INSERT ON merge_redirects WHEN NEW.entity_type = 'company'
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM companies WHERE id = NEW.source_id AND organization_id = NEW.organization_id
  ) OR NOT EXISTS (
    SELECT 1 FROM companies WHERE id = NEW.target_id AND organization_id = NEW.organization_id
  ) THEN RAISE(ABORT, 'company merge endpoints must belong to merge organization') END;
END;

CREATE TRIGGER merge_redirects_contact_insert
BEFORE INSERT ON merge_redirects WHEN NEW.entity_type = 'contact'
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM contacts WHERE id = NEW.source_id AND organization_id = NEW.organization_id
  ) OR NOT EXISTS (
    SELECT 1 FROM contacts WHERE id = NEW.target_id AND organization_id = NEW.organization_id
  ) THEN RAISE(ABORT, 'contact merge endpoints must belong to merge organization') END;
END;

CREATE TRIGGER merge_redirects_company_update
BEFORE UPDATE OF organization_id, entity_type, source_id, target_id ON merge_redirects
WHEN NEW.entity_type = 'company'
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM companies WHERE id = NEW.source_id AND organization_id = NEW.organization_id
  ) OR NOT EXISTS (
    SELECT 1 FROM companies WHERE id = NEW.target_id AND organization_id = NEW.organization_id
  ) THEN RAISE(ABORT, 'company merge endpoints must belong to merge organization') END;
END;

CREATE TRIGGER merge_redirects_contact_update
BEFORE UPDATE OF organization_id, entity_type, source_id, target_id ON merge_redirects
WHEN NEW.entity_type = 'contact'
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM contacts WHERE id = NEW.source_id AND organization_id = NEW.organization_id
  ) OR NOT EXISTS (
    SELECT 1 FROM contacts WHERE id = NEW.target_id AND organization_id = NEW.organization_id
  ) THEN RAISE(ABORT, 'contact merge endpoints must belong to merge organization') END;
END;

CREATE TRIGGER companies_merge_target_delete
BEFORE DELETE ON companies
WHEN EXISTS (
  SELECT 1 FROM merge_redirects
  WHERE organization_id = OLD.organization_id AND entity_type = 'company' AND target_id = OLD.id
)
BEGIN
  SELECT RAISE(ABORT, 'cannot delete a company that is a merge target');
END;

CREATE TRIGGER contacts_merge_target_delete
BEFORE DELETE ON contacts
WHEN EXISTS (
  SELECT 1 FROM merge_redirects
  WHERE organization_id = OLD.organization_id AND entity_type = 'contact' AND target_id = OLD.id
)
BEGIN
  SELECT RAISE(ABORT, 'cannot delete a contact that is a merge target');
END;
