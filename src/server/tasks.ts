import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { z } from 'zod';

export type TaskActor = {
  organizationId: string;
  membershipId: string;
  role: 'owner' | 'member' | 'viewer';
};
export class TaskError extends Error {
  constructor(
    public code: 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT' | 'VALIDATION',
    message: string,
  ) {
    super(message);
  }
}
const input = z.object({
  title: z.string().trim().min(1).max(240),
  description: z.string().trim().max(4000).optional().default(''),
  assigneeMembershipId: z.string().min(1),
  dueAt: z.string().datetime().nullable().optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium'),
  status: z.enum(['open', 'in_progress', 'completed', 'cancelled']).default('open'),
  companyId: z.string().min(1).nullable().optional(),
  contactId: z.string().min(1).nullable().optional(),
  dealId: z.string().min(1).nullable().optional(),
});
export type TaskInput = z.input<typeof input>;
function writer(actor: TaskActor) {
  if (actor.role === 'viewer') throw new TaskError('FORBIDDEN', 'Viewer access is read only.');
}
function row(db: Database.Database, actor: TaskActor, id: string, archived = false) {
  const value = db
    .prepare(
      `SELECT * FROM tasks WHERE id=? AND organization_id=? ${archived ? '' : 'AND archived_at IS NULL'}`,
    )
    .get(id, actor.organizationId) as Record<string, unknown> | undefined;
  if (!value) throw new TaskError('NOT_FOUND', 'Task not found.');
  return value;
}
function validate(db: Database.Database, actor: TaskActor, raw: TaskInput) {
  const parsed = input.safeParse(raw);
  if (!parsed.success)
    throw new TaskError('VALIDATION', 'Please correct the highlighted task fields.');
  const value = parsed.data;
  if (
    !db
      .prepare('SELECT 1 FROM memberships WHERE id=? AND organization_id=?')
      .get(value.assigneeMembershipId, actor.organizationId)
  )
    throw new TaskError('VALIDATION', 'Choose an active member in your organization.');
  for (const [table, id] of [
    ['companies', value.companyId],
    ['contacts', value.contactId],
    ['deals', value.dealId],
  ] as const)
    if (
      id &&
      !db
        .prepare(`SELECT 1 FROM ${table} WHERE id=? AND organization_id=?`)
        .get(id, actor.organizationId)
    )
      throw new TaskError('VALIDATION', `Choose a ${table.slice(0, -1)} in your organization.`);
  return value;
}
function serialise(value: Record<string, unknown>) {
  return {
    id: value.id,
    organizationId: value.organization_id,
    title: value.title,
    description: value.description,
    assigneeMembershipId: value.assignee_membership_id,
    dueAt: value.due_at,
    priority: value.priority,
    status: value.status,
    companyId: value.company_id,
    contactId: value.contact_id,
    dealId: value.deal_id,
    completedAt: value.completed_at,
    archivedAt: value.archived_at,
    createdAt: value.created_at,
    updatedAt: value.updated_at,
    version: value.version,
  };
}
export class TaskService {
  constructor(
    private db: Database.Database,
    private now = () => new Date().toISOString(),
  ) {}
  create(actor: TaskActor, raw: TaskInput) {
    writer(actor);
    const value = validate(this.db, actor, raw),
      now = this.now(),
      id = randomUUID(),
      complete = value.status === 'completed' ? now : null;
    const result = this.db
      .prepare(
        'INSERT INTO tasks (id,organization_id,title,description,assignee_membership_id,due_at,priority,status,company_id,contact_id,deal_id,completed_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      )
      .run(
        id,
        actor.organizationId,
        value.title,
        value.description,
        value.assigneeMembershipId,
        value.dueAt ?? null,
        value.priority,
        value.status,
        value.companyId ?? null,
        value.contactId ?? null,
        value.dealId ?? null,
        complete,
        now,
        now,
      );
    return this.get(actor, id);
  }
  get(actor: TaskActor, id: string, archived = false) {
    return serialise(row(this.db, actor, id, archived));
  }
  update(actor: TaskActor, id: string, raw: TaskInput, version: number) {
    writer(actor);
    const current = row(this.db, actor, id) as { version: number };
    if (current.version !== version)
      throw new TaskError('CONFLICT', 'This task changed elsewhere. Refresh and try again.');
    const value = validate(this.db, actor, raw),
      now = this.now(),
      completed = value.status === 'completed' ? now : null;
    const result = this.db
      .prepare(
        'UPDATE tasks SET title=?,description=?,assignee_membership_id=?,due_at=?,priority=?,status=?,company_id=?,contact_id=?,deal_id=?,completed_at=?,updated_at=?,version=version+1 WHERE id=? AND organization_id=? AND version=?',
      )
      .run(
        value.title,
        value.description,
        value.assigneeMembershipId,
        value.dueAt ?? null,
        value.priority,
        value.status,
        value.companyId ?? null,
        value.contactId ?? null,
        value.dealId ?? null,
        completed,
        now,
        id,
        actor.organizationId,
        version,
      );
    if (!result.changes)
      throw new TaskError('CONFLICT', 'This task changed elsewhere. Refresh and try again.');
    return this.get(actor, id);
  }
  archive(actor: TaskActor, id: string, version: number, restore = false) {
    writer(actor);
    const current = row(this.db, actor, id, true) as { version: number };
    if (current.version !== version)
      throw new TaskError('CONFLICT', 'This task changed elsewhere. Refresh and try again.');
    const result = this.db
      .prepare(
        'UPDATE tasks SET archived_at=?,updated_at=?,version=version+1 WHERE id=? AND organization_id=? AND version=?',
      )
      .run(restore ? null : this.now(), this.now(), id, actor.organizationId, version);
    if (!result.changes)
      throw new TaskError('CONFLICT', 'This task changed elsewhere. Refresh and try again.');
    return this.get(actor, id, true);
  }
  list(
    actor: TaskActor,
    view = 'all',
    now = this.now(),
    relation?: { companyId?: string; contactId?: string; dealId?: string },
  ) {
    const where = ['organization_id=?', 'archived_at IS NULL'];
    const values: unknown[] = [actor.organizationId];
    for (const [column, id] of [
      ['company_id', relation?.companyId],
      ['contact_id', relation?.contactId],
      ['deal_id', relation?.dealId],
    ] as const)
      if (id) {
        where.push(`${column}=?`);
        values.push(id);
      }
    if (view === 'assigned') {
      where.push('assignee_membership_id=?');
      values.push(actor.membershipId);
    }
    if (view === 'completed') where.push("status='completed'");
    else if (view === 'overdue') {
      where.push("status NOT IN ('completed','cancelled') AND due_at < ?");
      values.push(now);
    } else if (view === 'due-today') {
      where.push("status NOT IN ('completed','cancelled') AND due_at >= ? AND due_at < ?");
      const start = new Date(now);
      start.setUTCHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setUTCDate(end.getUTCDate() + 1);
      values.push(start.toISOString(), end.toISOString());
    } else if (view === 'upcoming') {
      where.push("status NOT IN ('completed','cancelled') AND due_at >= ?");
      values.push(now);
    }
    return this.db
      .prepare(
        `SELECT * FROM tasks WHERE ${where.join(' AND ')} ORDER BY due_at IS NULL, due_at, id`,
      )
      .all(...values)
      .map((item) => serialise(item as Record<string, unknown>));
  }
}
