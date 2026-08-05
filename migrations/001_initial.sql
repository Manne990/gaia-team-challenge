PRAGMA foreign_keys = ON;

CREATE TABLE organizations (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (id, name)
);

CREATE TABLE users (
  id TEXT PRIMARY KEY NOT NULL,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0)
);

CREATE TABLE memberships (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'member', 'viewer')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (organization_id, user_id),
  UNIQUE (organization_id, id)
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (organization_id, user_id) REFERENCES memberships(organization_id, user_id) ON DELETE CASCADE,
  UNIQUE (organization_id, id)
);

CREATE TABLE companies (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  external_reference TEXT,
  website TEXT,
  phone TEXT,
  industry TEXT,
  size TEXT,
  address TEXT,
  lifecycle_status TEXT NOT NULL DEFAULT 'lead' CHECK (lifecycle_status IN ('lead', 'prospect', 'customer', 'inactive')),
  owner_membership_id TEXT NOT NULL,
  tags_json TEXT NOT NULL DEFAULT '[]',
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  FOREIGN KEY (organization_id, owner_membership_id) REFERENCES memberships(organization_id, id) ON DELETE RESTRICT,
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, external_reference)
);

CREATE TABLE contacts (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  job_title TEXT,
  owner_membership_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'lead')),
  tags_json TEXT NOT NULL DEFAULT '[]',
  communication_preference TEXT NOT NULL DEFAULT 'email' CHECK (communication_preference IN ('email', 'phone', 'none')),
  company_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  FOREIGN KEY (organization_id, owner_membership_id) REFERENCES memberships(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, company_id) REFERENCES companies(organization_id, id) ON DELETE RESTRICT,
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, email)
);

CREATE TABLE pipeline_stages (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position >= 0),
  category TEXT NOT NULL CHECK (category IN ('open', 'won', 'lost')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, name),
  UNIQUE (organization_id, position)
);

CREATE TABLE deals (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  company_id TEXT NOT NULL,
  owner_membership_id TEXT NOT NULL,
  amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0),
  currency TEXT NOT NULL CHECK (length(currency) = 3),
  expected_close_date TEXT,
  probability INTEGER NOT NULL CHECK (probability BETWEEN 0 AND 100),
  stage_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open', 'won', 'lost')),
  loss_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  CHECK ((status = 'lost' AND loss_reason IS NOT NULL) OR status != 'lost'),
  FOREIGN KEY (organization_id, company_id) REFERENCES companies(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, owner_membership_id) REFERENCES memberships(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, stage_id) REFERENCES pipeline_stages(organization_id, id) ON DELETE RESTRICT,
  UNIQUE (organization_id, id)
);

CREATE TABLE deal_contacts (
  organization_id TEXT NOT NULL,
  deal_id TEXT NOT NULL,
  contact_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (organization_id, deal_id, contact_id),
  FOREIGN KEY (organization_id, deal_id) REFERENCES deals(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, contact_id) REFERENCES contacts(organization_id, id) ON DELETE CASCADE
);

CREATE TABLE tasks (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  assignee_membership_id TEXT NOT NULL,
  due_at TEXT,
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'completed', 'cancelled')),
  company_id TEXT,
  contact_id TEXT,
  deal_id TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  CHECK ((status = 'completed' AND completed_at IS NOT NULL) OR status != 'completed'),
  FOREIGN KEY (organization_id, assignee_membership_id) REFERENCES memberships(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, company_id) REFERENCES companies(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, contact_id) REFERENCES contacts(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, deal_id) REFERENCES deals(organization_id, id) ON DELETE RESTRICT,
  UNIQUE (organization_id, id)
);

CREATE TABLE activities (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('call', 'email', 'meeting', 'note', 'status_change')),
  subject TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  occurred_at TEXT NOT NULL,
  creator_membership_id TEXT NOT NULL,
  company_id TEXT,
  contact_id TEXT,
  deal_id TEXT,
  follow_up_task_id TEXT,
  participant_snapshot_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  FOREIGN KEY (organization_id, creator_membership_id) REFERENCES memberships(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, company_id) REFERENCES companies(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, contact_id) REFERENCES contacts(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, deal_id) REFERENCES deals(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, follow_up_task_id) REFERENCES tasks(organization_id, id) ON DELETE RESTRICT,
  UNIQUE (organization_id, id)
);

CREATE TABLE notifications (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  membership_id TEXT NOT NULL,
  dedupe_key TEXT NOT NULL,
  type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  read_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (organization_id, membership_id) REFERENCES memberships(organization_id, id) ON DELETE CASCADE,
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, membership_id, dedupe_key)
);

CREATE TABLE saved_views (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  membership_id TEXT NOT NULL,
  resource TEXT NOT NULL CHECK (resource IN ('companies', 'contacts', 'deals', 'tasks')),
  name TEXT NOT NULL,
  query_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  FOREIGN KEY (organization_id, membership_id) REFERENCES memberships(organization_id, id) ON DELETE CASCADE,
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, membership_id, resource, name)
);

CREATE TABLE imports (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  creator_membership_id TEXT NOT NULL,
  resource TEXT NOT NULL CHECK (resource IN ('companies', 'contacts')),
  filename TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('preview', 'committed', 'failed')),
  summary_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  committed_at TEXT,
  FOREIGN KEY (organization_id, creator_membership_id) REFERENCES memberships(organization_id, id) ON DELETE RESTRICT,
  UNIQUE (organization_id, id)
);

CREATE TABLE import_rows (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  import_id TEXT NOT NULL,
  row_number INTEGER NOT NULL CHECK (row_number > 0),
  status TEXT NOT NULL CHECK (status IN ('valid', 'warning', 'error', 'committed')),
  errors_json TEXT NOT NULL DEFAULT '[]',
  mapped_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (organization_id, import_id) REFERENCES imports(organization_id, id) ON DELETE CASCADE,
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, import_id, row_number)
);

CREATE TABLE merge_redirects (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  resource TEXT NOT NULL CHECK (resource IN ('company', 'contact')),
  source_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  actor_membership_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  CHECK (source_id != target_id),
  FOREIGN KEY (organization_id, actor_membership_id) REFERENCES memberships(organization_id, id) ON DELETE RESTRICT,
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, resource, source_id)
);

CREATE TABLE audit_events (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  actor_membership_id TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  change_summary_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (organization_id, actor_membership_id) REFERENCES memberships(organization_id, id) ON DELETE SET NULL,
  UNIQUE (organization_id, id)
);

CREATE INDEX companies_org_name_idx ON companies(organization_id, name);
CREATE INDEX contacts_org_name_idx ON contacts(organization_id, last_name, first_name);
CREATE INDEX activities_org_occurred_idx ON activities(organization_id, occurred_at DESC);
CREATE INDEX deals_org_stage_idx ON deals(organization_id, stage_id);
CREATE INDEX tasks_org_due_idx ON tasks(organization_id, due_at);
CREATE INDEX audit_events_org_created_idx ON audit_events(organization_id, created_at DESC);

CREATE TRIGGER audit_events_are_append_only_update
BEFORE UPDATE ON audit_events
BEGIN
  SELECT RAISE(ABORT, 'audit events are append-only');
END;

CREATE TRIGGER audit_events_are_append_only_delete
BEFORE DELETE ON audit_events
BEGIN
  SELECT RAISE(ABORT, 'audit events are append-only');
END;
