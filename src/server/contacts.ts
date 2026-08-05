import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { z } from 'zod';

export type ContactActor = {
  organizationId: string;
  membershipId: string;
  role: 'owner' | 'member' | 'viewer';
};

export class ContactError extends Error {
  constructor(
    public readonly code: 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT' | 'VALIDATION',
    message: string,
  ) {
    super(message);
  }
}

const text = z.string().trim().max(500);
const inputSchema = z.object({
  firstName: text.min(1),
  lastName: text.min(1),
  email: z.string().trim().email().max(320).optional().nullable(),
  phone: text.optional().nullable(),
  jobTitle: text.optional().nullable(),
  ownerMembershipId: z.string().min(1),
  status: z.enum(['active', 'inactive', 'lead']).default('active'),
  tags: z.array(text.min(1).max(80)).max(30).default([]),
  communicationPreference: z.enum(['email', 'phone', 'none']).default('email'),
  companyId: z.string().min(1).optional().nullable(),
});

export type ContactInput = z.input<typeof inputSchema>;
type ContactRow = {
  id: string;
  organization_id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  job_title: string | null;
  owner_membership_id: string;
  status: string;
  tags_json: string;
  communication_preference: string;
  company_id: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  version: number;
  company_name?: string | null;
};

function requireWriter(actor: ContactActor) {
  if (actor.role === 'viewer') throw new ContactError('FORBIDDEN', 'Viewer access is read only.');
}
function normalized(input: ContactInput) {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success)
    throw new ContactError('VALIDATION', 'Please correct the highlighted contact fields.');
  const value = parsed.data;
  return {
    ...value,
    email: value.email?.toLowerCase() || null,
    phone: value.phone || null,
    jobTitle: value.jobTitle || null,
    companyId: value.companyId || null,
    tags: [...new Set(value.tags.map((tag) => tag.toLowerCase()))].sort(),
  };
}
function contact(row: ContactRow) {
  return {
    id: row.id,
    organizationId: row.organization_id,
    firstName: row.first_name,
    lastName: row.last_name,
    email: row.email,
    phone: row.phone,
    jobTitle: row.job_title,
    ownerMembershipId: row.owner_membership_id,
    status: row.status,
    tags: JSON.parse(row.tags_json) as string[],
    communicationPreference: row.communication_preference,
    companyId: row.company_id,
    companyName: row.company_name ?? null,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: row.version,
  };
}
function one(
  db: Database.Database,
  actor: ContactActor,
  id: string,
  includeArchived = false,
): ContactRow {
  const row = db
    .prepare(
      `SELECT c.*, company.name AS company_name FROM contacts c LEFT JOIN companies company ON company.id = c.company_id AND company.organization_id = c.organization_id WHERE c.id = ? AND c.organization_id = ? ${includeArchived ? '' : 'AND c.archived_at IS NULL'}`,
    )
    .get(id, actor.organizationId) as ContactRow | undefined;
  if (!row) throw new ContactError('NOT_FOUND', 'Contact not found.');
  return row;
}
function verifyRelationship(
  db: Database.Database,
  actor: ContactActor,
  values: ReturnType<typeof normalized>,
) {
  const membership = db
    .prepare('SELECT 1 FROM memberships WHERE id = ? AND organization_id = ?')
    .get(values.ownerMembershipId, actor.organizationId);
  if (!membership) throw new ContactError('VALIDATION', 'Choose an owner in your organization.');
  if (
    values.companyId &&
    !db
      .prepare('SELECT 1 FROM companies WHERE id = ? AND organization_id = ?')
      .get(values.companyId, actor.organizationId)
  )
    throw new ContactError('VALIDATION', 'Choose a company in your organization.');
}
function history(
  db: Database.Database,
  actor: ContactActor,
  contactId: string,
  action: string,
  changes: unknown,
  now: string,
) {
  db.prepare(
    'INSERT INTO contact_history (id, organization_id, contact_id, actor_membership_id, action, changes_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(
    randomUUID(),
    actor.organizationId,
    contactId,
    actor.membershipId,
    action,
    JSON.stringify(changes),
    now,
  );
}

export class ContactService {
  constructor(
    private readonly db: Database.Database,
    private readonly now = () => new Date().toISOString(),
  ) {}
  create(actor: ContactActor, input: ContactInput) {
    requireWriter(actor);
    const values = normalized(input);
    verifyRelationship(this.db, actor, values);
    const id = randomUUID();
    const now = this.now();
    try {
      this.db.transaction(() => {
        this.db
          .prepare(
            'INSERT INTO contacts (id, organization_id, first_name, last_name, email, phone, job_title, owner_membership_id, status, tags_json, communication_preference, company_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          )
          .run(
            id,
            actor.organizationId,
            values.firstName,
            values.lastName,
            values.email,
            values.phone,
            values.jobTitle,
            values.ownerMembershipId,
            values.status,
            JSON.stringify(values.tags),
            values.communicationPreference,
            values.companyId,
            now,
            now,
          );
        history(this.db, actor, id, 'created', values, now);
      })();
    } catch (error) {
      if (error instanceof ContactError) throw error;
      if (
        error instanceof Error &&
        error.message.includes('UNIQUE constraint failed: contacts.organization_id, contacts.email')
      )
        throw new ContactError(
          'CONFLICT',
          'A contact with this email already exists in your organization.',
        );
      throw error;
    }
    return this.get(actor, id, true);
  }
  get(actor: ContactActor, id: string, includeArchived = false) {
    const item = contact(one(this.db, actor, id, includeArchived));
    const historyRows = this.db
      .prepare(
        'SELECT action, changes_json AS changes, created_at AS createdAt FROM contact_history WHERE organization_id = ? AND contact_id = ? ORDER BY created_at DESC, rowid DESC',
      )
      .all(actor.organizationId, id) as { action: string; changes: string; createdAt: string }[];
    const activities = this.db
      .prepare(
        'SELECT id, subject, occurred_at AS occurredAt FROM activities WHERE organization_id = ? AND contact_id = ? ORDER BY occurred_at DESC',
      )
      .all(actor.organizationId, id);
    const deals = this.db
      .prepare(
        'SELECT d.id, d.name, d.status FROM deals d JOIN deal_contacts dc ON dc.deal_id = d.id AND dc.organization_id = d.organization_id WHERE dc.organization_id = ? AND dc.contact_id = ?',
      )
      .all(actor.organizationId, id);
    const tasks = this.db
      .prepare(
        'SELECT id, title, status, due_at AS dueAt FROM tasks WHERE organization_id = ? AND contact_id = ? ORDER BY due_at',
      )
      .all(actor.organizationId, id);
    return {
      ...item,
      history: historyRows.map((row) => ({ ...row, changes: JSON.parse(row.changes) })),
      activities,
      deals,
      tasks,
    };
  }
  list(
    actor: ContactActor,
    query: {
      page?: number;
      pageSize?: number;
      sort?: 'name' | 'email' | 'updatedAt';
      direction?: 'asc' | 'desc';
      companyId?: string;
      ownerMembershipId?: string;
      status?: string;
      tag?: string;
      text?: string;
      includeArchived?: boolean;
    } = {},
  ) {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 25));
    const conditions = ['c.organization_id = @organizationId'];
    const values: Record<string, string | number> = {
      organizationId: actor.organizationId,
      limit: pageSize,
      offset: (page - 1) * pageSize,
    };
    if (!query.includeArchived) conditions.push('c.archived_at IS NULL');
    if (query.companyId) {
      conditions.push('c.company_id = @companyId');
      values.companyId = query.companyId;
    }
    if (query.ownerMembershipId) {
      conditions.push('c.owner_membership_id = @ownerMembershipId');
      values.ownerMembershipId = query.ownerMembershipId;
    }
    if (query.status) {
      conditions.push('c.status = @status');
      values.status = query.status;
    }
    if (query.tag) {
      conditions.push('EXISTS (SELECT 1 FROM json_each(c.tags_json) WHERE value = @tag)');
      values.tag = query.tag.toLowerCase();
    }
    if (query.text) {
      conditions.push(
        "(c.first_name || ' ' || c.last_name LIKE @text ESCAPE '\\' OR lower(coalesce(c.email, '')) LIKE @text ESCAPE '\\')",
      );
      values.text = `%${query.text
        .trim()
        .toLowerCase()
        .replace(/[\\%_]/g, '\\$&')}%`;
    }
    const where = conditions.join(' AND ');
    const sort =
      query.sort === 'email'
        ? 'c.email'
        : query.sort === 'updatedAt'
          ? 'c.updated_at'
          : 'c.last_name, c.first_name';
    const direction = query.direction === 'asc' ? 'ASC' : 'DESC';
    const total = (
      this.db.prepare(`SELECT count(*) AS total FROM contacts c WHERE ${where}`).get(values) as {
        total: number;
      }
    ).total;
    const rows = this.db
      .prepare(
        `SELECT c.*, company.name AS company_name FROM contacts c LEFT JOIN companies company ON company.id = c.company_id AND company.organization_id = c.organization_id WHERE ${where} ORDER BY ${sort} ${direction}, c.id ${direction} LIMIT @limit OFFSET @offset`,
      )
      .all(values) as ContactRow[];
    return {
      items: rows.map(contact),
      page,
      pageSize,
      total,
      pages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }
  update(actor: ContactActor, id: string, input: ContactInput, version: number) {
    requireWriter(actor);
    const previous = one(this.db, actor, id);
    if (previous.version !== version)
      throw new ContactError(
        'CONFLICT',
        'This contact changed elsewhere. Refresh and review before saving.',
      );
    const values = normalized(input);
    verifyRelationship(this.db, actor, values);
    const now = this.now();
    try {
      this.db.transaction(() => {
        const result = this.db
          .prepare(
            'UPDATE contacts SET first_name = ?, last_name = ?, email = ?, phone = ?, job_title = ?, owner_membership_id = ?, status = ?, tags_json = ?, communication_preference = ?, company_id = ?, updated_at = ?, version = version + 1 WHERE id = ? AND organization_id = ? AND version = ?',
          )
          .run(
            values.firstName,
            values.lastName,
            values.email,
            values.phone,
            values.jobTitle,
            values.ownerMembershipId,
            values.status,
            JSON.stringify(values.tags),
            values.communicationPreference,
            values.companyId,
            now,
            id,
            actor.organizationId,
            version,
          );
        if (result.changes !== 1)
          throw new ContactError(
            'CONFLICT',
            'This contact changed elsewhere. Refresh and review before saving.',
          );
        history(this.db, actor, id, 'updated', values, now);
      })();
    } catch (error) {
      if (error instanceof ContactError) throw error;
      if (
        error instanceof Error &&
        error.message.includes('UNIQUE constraint failed: contacts.organization_id, contacts.email')
      )
        throw new ContactError(
          'CONFLICT',
          'A contact with this email already exists in your organization.',
        );
      throw error;
    }
    return this.get(actor, id, true);
  }
  archive(actor: ContactActor, id: string, version: number) {
    return this.setArchive(actor, id, version, true);
  }
  restore(actor: ContactActor, id: string, version: number) {
    return this.setArchive(actor, id, version, false);
  }
  private setArchive(actor: ContactActor, id: string, version: number, archived: boolean) {
    requireWriter(actor);
    one(this.db, actor, id, true);
    const now = this.now();
    const result = this.db
      .prepare(
        'UPDATE contacts SET archived_at = ?, updated_at = ?, version = version + 1 WHERE id = ? AND organization_id = ? AND version = ?',
      )
      .run(archived ? now : null, now, id, actor.organizationId, version);
    if (result.changes !== 1)
      throw new ContactError(
        'CONFLICT',
        'This contact changed elsewhere. Refresh and review before saving.',
      );
    history(this.db, actor, id, archived ? 'archived' : 'restored', {}, now);
    return this.get(actor, id, true);
  }
}
