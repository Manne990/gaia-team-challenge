import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { z } from 'zod';

export type ActivityActor = {
  organizationId: string;
  membershipId: string;
  role: 'owner' | 'member' | 'viewer';
};
export class ActivityError extends Error {
  constructor(
    public code: 'FORBIDDEN' | 'NOT_FOUND' | 'VALIDATION' | 'CONFLICT',
    message: string,
  ) {
    super(message);
  }
}
const schema = z.object({
  type: z.enum(['call', 'email', 'meeting', 'note', 'status_change']),
  subject: z.string().trim().min(1).max(250),
  body: z.string().trim().max(10_000).default(''),
  occurredAt: z.string().datetime(),
  companyId: z.string().optional().nullable(),
  contactId: z.string().optional().nullable(),
  dealId: z.string().optional().nullable(),
  participants: z.array(z.string().trim().min(1).max(120)).max(50).default([]),
  followUp: z
    .object({
      title: z.string().trim().min(1).max(250),
      dueAt: z.string().datetime().optional().nullable(),
      priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium'),
      assigneeMembershipId: z.string().min(1).optional(),
    })
    .optional(),
});
export type ActivityInput = z.input<typeof schema>;
function writer(actor: ActivityActor) {
  if (actor.role === 'viewer') throw new ActivityError('FORBIDDEN', 'Viewer access is read only.');
}
function labels(db: Database.Database, actor: ActivityActor, input: z.output<typeof schema>) {
  const lookup = (table: string, id?: string | null, column = 'name') =>
    !id
      ? null
      : (db
          .prepare(`SELECT ${column} AS label FROM ${table} WHERE id=? AND organization_id=?`)
          .get(id, actor.organizationId) as { label: string } | undefined);
  const company = lookup('companies', input.companyId),
    contact = input.contactId
      ? (db
          .prepare(
            "SELECT first_name || ' ' || last_name AS label FROM contacts WHERE id=? AND organization_id=?",
          )
          .get(input.contactId, actor.organizationId) as { label: string } | undefined)
      : undefined;
  if (
    (input.companyId !== null && input.companyId !== undefined && company === undefined) ||
    (input.contactId !== null && input.contactId !== undefined && contact === undefined) ||
    (input.dealId !== null &&
      input.dealId !== undefined &&
      lookup('deals', input.dealId) === undefined)
  )
    throw new ActivityError('VALIDATION', 'Choose related records from your organization.');
  const author = db
    .prepare(
      'SELECT u.display_name AS label FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.id=? AND m.organization_id=?',
    )
    .get(actor.membershipId, actor.organizationId) as { label: string } | undefined;
  if (!author) throw new ActivityError('FORBIDDEN', 'Your membership is no longer active.');
  return { company: company?.label ?? null, contact: contact?.label ?? null, author: author.label };
}
export class ActivityService {
  constructor(
    private db: Database.Database,
    private now = () => new Date().toISOString(),
  ) {}
  create(actor: ActivityActor, raw: ActivityInput) {
    writer(actor);
    const parsed = schema.safeParse(raw);
    if (!parsed.success)
      throw new ActivityError('VALIDATION', 'Please correct the activity details.');
    const input = parsed.data,
      id = randomUUID(),
      now = this.now(),
      related = labels(this.db, actor, input);
    let taskId: string | null = null;
    this.db.transaction(() => {
      if (input.followUp) {
        taskId = randomUUID();
        this.db
          .prepare(
            'INSERT INTO tasks (id,organization_id,title,assignee_membership_id,due_at,priority,status,company_id,contact_id,deal_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
          )
          .run(
            taskId,
            actor.organizationId,
            input.followUp.title,
            input.followUp.assigneeMembershipId ?? actor.membershipId,
            input.followUp.dueAt ?? null,
            input.followUp.priority,
            'open',
            input.companyId ?? null,
            input.contactId ?? null,
            input.dealId ?? null,
            now,
            now,
          );
      }
      this.db
        .prepare(
          'INSERT INTO activities (id,organization_id,type,subject,body,occurred_at,creator_membership_id,company_id,contact_id,deal_id,follow_up_task_id,participant_snapshot_json,creator_label_snapshot,company_label_snapshot,contact_label_snapshot,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        )
        .run(
          id,
          actor.organizationId,
          input.type,
          input.subject,
          input.body,
          input.occurredAt,
          actor.membershipId,
          input.companyId ?? null,
          input.contactId ?? null,
          input.dealId ?? null,
          taskId,
          JSON.stringify(input.participants),
          related.author,
          related.company,
          related.contact,
          now,
        );
    })();
    return this.get(actor, id);
  }
  get(actor: ActivityActor, id: string) {
    const row = this.db
      .prepare('SELECT * FROM activities WHERE id=? AND organization_id=?')
      .get(id, actor.organizationId);
    if (!row) throw new ActivityError('NOT_FOUND', 'Activity not found.');
    return row;
  }
  list(
    actor: ActivityActor,
    query: {
      page?: number;
      pageSize?: number;
      type?: string;
      author?: string;
      companyId?: string;
      contactId?: string;
      from?: string;
      to?: string;
    } = {},
  ) {
    const terms = ['organization_id=?'],
      values: unknown[] = [actor.organizationId];
    for (const [field, column] of [
      ['type', 'type'],
      ['author', 'creator_membership_id'],
      ['companyId', 'company_id'],
      ['contactId', 'contact_id'],
    ] as const)
      if (query[field]) {
        terms.push(`${column}=?`);
        values.push(query[field]);
      }
    if (query.from) {
      terms.push('occurred_at>=?');
      values.push(query.from);
    }
    if (query.to) {
      terms.push('occurred_at<=?');
      values.push(query.to);
    }
    const page = Math.max(1, query.page ?? 1),
      pageSize = Math.min(100, Math.max(1, query.pageSize ?? 25)),
      where = terms.join(' AND ');
    const total = (
      this.db.prepare(`SELECT count(*) AS total FROM activities WHERE ${where}`).get(...values) as {
        total: number;
      }
    ).total;
    return {
      items: this.db
        .prepare(
          `SELECT * FROM activities WHERE ${where} ORDER BY occurred_at DESC,id DESC LIMIT ? OFFSET ?`,
        )
        .all(...values, pageSize, (page - 1) * pageSize),
      page,
      pageSize,
      total,
    };
  }
}
