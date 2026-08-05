import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';

export type AuditActor = {
  organizationId: string;
  membershipId: string;
  role: 'owner' | 'member' | 'viewer';
};
export class AuditError extends Error {
  constructor(
    public code: 'FORBIDDEN' | 'VALIDATION',
    message: string,
  ) {
    super(message);
  }
}
const forbidden = /password|secret|token|cookie|csv|raw|credential/i;
function owner(actor: AuditActor) {
  if (actor.role !== 'owner')
    throw new AuditError('FORBIDDEN', 'Only organization owners can access audit records.');
}
function safe(value: unknown): unknown {
  if (Array.isArray(value)) return { itemCount: value.length };
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !forbidden.test(key))
      .map(([key, item]) => [key, safe(item)]),
  );
}
export function appendAudit(
  db: Database.Database,
  actor: AuditActor,
  action: string,
  entityType: string,
  entityId: string,
  summary: unknown,
  correlationId: string = randomUUID(),
) {
  db.prepare(
    'INSERT INTO audit_events (id,organization_id,actor_membership_id,action,entity_type,entity_id,change_summary_json,created_at) VALUES (?,?,?,?,?,?,?,?)',
  ).run(
    randomUUID(),
    actor.organizationId,
    actor.membershipId,
    action,
    entityType,
    entityId,
    JSON.stringify({ correlationId, changes: safe(summary) }),
    new Date().toISOString(),
  );
}
export function listAudit(db: Database.Database, actor: AuditActor, query: URLSearchParams) {
  owner(actor);
  const page = Math.max(1, Number(query.get('page') ?? 1) || 1),
    pageSize = Math.min(100, Math.max(1, Number(query.get('pageSize') ?? 25) || 25));
  const clauses = ['organization_id=?'],
    values: unknown[] = [actor.organizationId];
  for (const [key, column] of [
    ['action', 'action'],
    ['entityType', 'entity_type'],
    ['entityId', 'entity_id'],
  ] as const)
    if (query.get(key)) {
      clauses.push(`${column}=?`);
      values.push(query.get(key));
    }
  const where = clauses.join(' AND ');
  const total = (
    db.prepare(`SELECT count(*) AS count FROM audit_events WHERE ${where}`).get(...values) as {
      count: number;
    }
  ).count;
  const items = db
    .prepare(
      `SELECT id,actor_membership_id AS actorMembershipId,action,entity_type AS entityType,entity_id AS entityId,change_summary_json AS summary,created_at AS createdAt FROM audit_events WHERE ${where} ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?`,
    )
    .all(...values, pageSize, (page - 1) * pageSize)
    .map((row) => ({
      ...(row as Record<string, unknown>),
      summary: JSON.parse((row as { summary: string }).summary),
    }));
  return { items, page, pageSize, total, totalPages: Math.ceil(total / pageSize) };
}
