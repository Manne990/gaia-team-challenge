import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { z } from 'zod';

export type DealActor = {
  organizationId: string;
  membershipId: string;
  role: 'owner' | 'member' | 'viewer';
};
export class DealError extends Error {
  constructor(
    public readonly code: 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT' | 'VALIDATION',
    message: string,
  ) {
    super(message);
  }
}
const dealInput = z.object({
  name: z.string().trim().min(1).max(180),
  companyId: z.string().min(1),
  ownerMembershipId: z.string().min(1),
  amountMinor: z.number().int().min(0),
  currency: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{3}$/),
  expectedCloseDate: z.string().date().optional().nullable(),
  probability: z.number().int().min(0).max(100),
  stageId: z.string().min(1),
  contactIds: z.array(z.string().min(1)).max(100).default([]),
  lossReason: z.string().trim().min(1).max(1000).optional().nullable(),
});
export type DealInput = z.input<typeof dealInput>;
function writer(actor: DealActor) {
  if (actor.role === 'viewer') throw new DealError('FORBIDDEN', 'Viewer access is read only.');
}
function value(input: DealInput) {
  const parsed = dealInput.safeParse(input);
  if (!parsed.success)
    throw new DealError('VALIDATION', 'Please correct the highlighted deal fields.');
  return {
    ...parsed.data,
    currency: parsed.data.currency.toUpperCase(),
    contactIds: [...new Set(parsed.data.contactIds)],
  };
}
function stage(db: Database.Database, org: string, id: string, active = true) {
  const row = db
    .prepare(
      `SELECT * FROM pipeline_stages WHERE organization_id=? AND id=? ${active ? 'AND is_active=1' : ''}`,
    )
    .get(org, id) as { id: string; category: 'open' | 'won' | 'lost' } | undefined;
  if (!row)
    throw new DealError('VALIDATION', 'Choose an active pipeline stage in your organization.');
  return row;
}
function audit(
  db: Database.Database,
  actor: DealActor,
  dealId: string,
  action: string,
  fromStage: string | null,
  toStage: string | null,
  summary: unknown,
  now: string,
) {
  db.prepare(
    'INSERT INTO deal_history (id,organization_id,deal_id,actor_membership_id,action,from_stage_id,to_stage_id,summary_json,created_at) VALUES (?,?,?,?,?,?,?,?,?)',
  ).run(
    randomUUID(),
    actor.organizationId,
    dealId,
    actor.membershipId,
    action,
    fromStage,
    toStage,
    JSON.stringify(summary),
    now,
  );
  db.prepare(
    'INSERT INTO audit_events (id,organization_id,actor_membership_id,action,entity_type,entity_id,change_summary_json,created_at) VALUES (?,?,?,?,?,?,?,?)',
  ).run(
    randomUUID(),
    actor.organizationId,
    actor.membershipId,
    `deal.${action}`,
    'deal',
    dealId,
    JSON.stringify(summary),
    now,
  );
}
function get(db: Database.Database, actor: DealActor, id: string, archived = false) {
  const row = db
    .prepare(
      `SELECT d.*, c.name AS company_name, s.name AS stage_name, s.category AS stage_category FROM deals d JOIN companies c ON c.id=d.company_id AND c.organization_id=d.organization_id JOIN pipeline_stages s ON s.id=d.stage_id AND s.organization_id=d.organization_id WHERE d.organization_id=? AND d.id=? ${archived ? '' : 'AND d.archived_at IS NULL'}`,
    )
    .get(actor.organizationId, id) as Record<string, unknown> | undefined;
  if (!row) throw new DealError('NOT_FOUND', 'Deal not found.');
  return {
    ...row,
    contacts: db
      .prepare(
        'SELECT c.id,c.first_name,c.last_name,c.email FROM contacts c JOIN deal_contacts dc ON dc.contact_id=c.id AND dc.organization_id=c.organization_id WHERE dc.organization_id=? AND dc.deal_id=?',
      )
      .all(actor.organizationId, id),
    history: db
      .prepare(
        'SELECT * FROM deal_history WHERE organization_id=? AND deal_id=? ORDER BY created_at DESC,rowid DESC',
      )
      .all(actor.organizationId, id),
  };
}
export class DealService {
  constructor(
    private readonly db: Database.Database,
    private readonly now = () => new Date().toISOString(),
  ) {}
  create(actor: DealActor, input: DealInput) {
    writer(actor);
    const item = value(input),
      selected = stage(this.db, actor.organizationId, item.stageId),
      now = this.now(),
      id = randomUUID();
    if (selected.category === 'lost' && !item.lossReason)
      throw new DealError('VALIDATION', 'A loss reason is required for lost deals.');
    this.db.transaction(() => {
      if (
        !this.db
          .prepare('SELECT 1 FROM companies WHERE organization_id=? AND id=?')
          .get(actor.organizationId, item.companyId)
      )
        throw new DealError('VALIDATION', 'Choose a company in your organization.');
      if (
        !this.db
          .prepare('SELECT 1 FROM memberships WHERE organization_id=? AND id=?')
          .get(actor.organizationId, item.ownerMembershipId)
      )
        throw new DealError('VALIDATION', 'Choose an owner in your organization.');
      for (const contactId of item.contactIds)
        if (
          !this.db
            .prepare(
              'SELECT 1 FROM contacts WHERE organization_id=? AND id=? AND archived_at IS NULL',
            )
            .get(actor.organizationId, contactId)
        )
          throw new DealError('VALIDATION', 'Choose contacts in your organization.');
      const status = selected.category;
      this.db
        .prepare(
          'INSERT INTO deals (id,organization_id,name,company_id,owner_membership_id,amount_minor,currency,expected_close_date,probability,stage_id,status,loss_reason,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        )
        .run(
          id,
          actor.organizationId,
          item.name,
          item.companyId,
          item.ownerMembershipId,
          item.amountMinor,
          item.currency,
          item.expectedCloseDate,
          selected.category === 'won' ? 100 : selected.category === 'lost' ? 0 : item.probability,
          selected.id,
          status,
          selected.category === 'lost' ? item.lossReason : null,
          now,
          now,
        );
      for (const contactId of item.contactIds)
        this.db
          .prepare(
            'INSERT INTO deal_contacts (organization_id,deal_id,contact_id,created_at) VALUES (?,?,?,?)',
          )
          .run(actor.organizationId, id, contactId, now);
      audit(this.db, actor, id, 'created', null, selected.id, { status }, now);
    })();
    return get(this.db, actor, id);
  }
  transition(
    actor: DealActor,
    id: string,
    version: number,
    stageId: string,
    lossReason?: string | null,
  ) {
    writer(actor);
    const current = get(this.db, actor, id) as Record<string, unknown>;
    if (current.version !== version)
      throw new DealError('CONFLICT', 'This deal changed elsewhere. Refresh and try again.');
    const target = stage(this.db, actor.organizationId, stageId);
    if (target.category === 'lost' && !lossReason?.trim())
      throw new DealError('VALIDATION', 'A loss reason is required for lost deals.');
    const now = this.now();
    this.db.transaction(() => {
      const result = this.db
        .prepare(
          'UPDATE deals SET stage_id=?,status=?,probability=?,loss_reason=?,updated_at=?,version=version+1 WHERE organization_id=? AND id=? AND version=?',
        )
        .run(
          target.id,
          target.category,
          target.category === 'won' ? 100 : target.category === 'lost' ? 0 : current.probability,
          target.category === 'lost' ? lossReason!.trim() : null,
          now,
          actor.organizationId,
          id,
          version,
        );
      if (result.changes !== 1)
        throw new DealError('CONFLICT', 'This deal changed elsewhere. Refresh and try again.');
      audit(
        this.db,
        actor,
        id,
        'transitioned',
        current.stage_id as string,
        target.id,
        {
          status: target.category,
          lossReason: target.category === 'lost' ? lossReason!.trim() : null,
        },
        now,
      );
    })();
    return get(this.db, actor, id);
  }
  archive(actor: DealActor, id: string, version: number, restore = false) {
    writer(actor);
    const current = get(this.db, actor, id, true) as Record<string, unknown>;
    if (current.version !== version)
      throw new DealError('CONFLICT', 'This deal changed elsewhere. Refresh and try again.');
    const now = this.now();
    this.db.transaction(() => {
      const result = this.db
        .prepare(
          'UPDATE deals SET archived_at=?,updated_at=?,version=version+1 WHERE organization_id=? AND id=? AND version=?',
        )
        .run(restore ? null : now, now, actor.organizationId, id, version);
      if (result.changes !== 1)
        throw new DealError('CONFLICT', 'This deal changed elsewhere. Refresh and try again.');
      audit(
        this.db,
        actor,
        id,
        restore ? 'restored' : 'archived',
        current.stage_id as string,
        current.stage_id as string,
        {},
        now,
      );
    })();
    return get(this.db, actor, id, true);
  }
  configureStage(
    actor: DealActor,
    input: {
      id?: string;
      name: string;
      position: number;
      category: 'open' | 'won' | 'lost';
      isActive?: boolean;
      version?: number;
    },
  ) {
    if (actor.role !== 'owner')
      throw new DealError('FORBIDDEN', 'Only owners can configure pipeline stages.');
    if (!input.name.trim() || !Number.isInteger(input.position) || input.position < 0)
      throw new DealError('VALIDATION', 'Enter a stage name and non-negative position.');
    const now = this.now();
    if (!input.id) {
      const id = randomUUID();
      this.db
        .prepare(
          'INSERT INTO pipeline_stages (id,organization_id,name,position,category,is_active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)',
        )
        .run(
          id,
          actor.organizationId,
          input.name.trim(),
          input.position,
          input.category,
          input.isActive === false ? 0 : 1,
          now,
          now,
        );
      return this.db.prepare('SELECT * FROM pipeline_stages WHERE id=?').get(id);
    }
    const result = this.db
      .prepare(
        'UPDATE pipeline_stages SET name=?,position=?,category=?,is_active=?,updated_at=?,version=version+1 WHERE organization_id=? AND id=? AND version=?',
      )
      .run(
        input.name.trim(),
        input.position,
        input.category,
        input.isActive === false ? 0 : 1,
        now,
        actor.organizationId,
        input.id,
        input.version,
      );
    if (!result.changes)
      throw new DealError('CONFLICT', 'This stage changed elsewhere. Refresh and try again.');
    return this.db
      .prepare('SELECT * FROM pipeline_stages WHERE organization_id=? AND id=?')
      .get(actor.organizationId, input.id);
  }
  list(
    actor: DealActor,
    query: {
      stageId?: string;
      status?: string;
      companyId?: string;
      text?: string;
      includeArchived?: boolean;
      closingSoon?: boolean;
    } = {},
  ) {
    const conditions = ['d.organization_id=@organizationId'];
    const params: Record<string, string> = { organizationId: actor.organizationId };
    if (!query.includeArchived) conditions.push('d.archived_at IS NULL');
    for (const [key, column] of [
      ['stageId', 'd.stage_id'],
      ['status', 'd.status'],
      ['companyId', 'd.company_id'],
    ] as const)
      if (query[key]) {
        conditions.push(`${column}=@${key}`);
        params[key] = query[key]!;
      }
    if (query.text) {
      conditions.push('(d.name LIKE @text OR c.name LIKE @text)');
      params.text = `%${query.text.trim()}%`;
    }
    if (query.closingSoon) {
      const now = this.now();
      const week = new Date(now);
      week.setUTCDate(week.getUTCDate() + 7);
      conditions.push(
        'd.expected_close_date >= @closingStart AND d.expected_close_date < @closingEnd',
      );
      params.closingStart = now.slice(0, 10);
      params.closingEnd = week.toISOString().slice(0, 10);
    }
    const where = conditions.join(' AND ');
    const items = this.db
      .prepare(
        `SELECT d.*,c.name AS company_name,s.name AS stage_name FROM deals d JOIN companies c ON c.id=d.company_id AND c.organization_id=d.organization_id JOIN pipeline_stages s ON s.id=d.stage_id AND s.organization_id=d.organization_id WHERE ${where} ORDER BY d.expected_close_date,d.name`,
      )
      .all(params);
    const totals = this.db
      .prepare(
        `SELECT d.stage_id,s.name,COUNT(*) AS count,COALESCE(SUM(d.amount_minor),0) AS amountMinor FROM deals d JOIN pipeline_stages s ON s.id=d.stage_id AND s.organization_id=d.organization_id WHERE ${where} GROUP BY d.stage_id,s.name ORDER BY s.position`,
      )
      .all(params);
    return { items, totals };
  }
}
