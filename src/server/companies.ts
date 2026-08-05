import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';

export type CompanyInput = {
  name: string;
  externalReference?: string | null;
  website?: string | null;
  phone?: string | null;
  industry?: string | null;
  size?: string | null;
  address?: string | null;
  lifecycleStatus?: 'lead' | 'prospect' | 'customer' | 'inactive';
  tags?: string[];
  description?: string | null;
  ownerMembershipId?: string;
};
const statuses = new Set(['lead', 'prospect', 'customer', 'inactive']);
function clean(input: CompanyInput) {
  if (!input.name?.trim()) throw new CompanyError('VALIDATION', 'Company name is required.', 400);
  if (input.name.trim().length > 180)
    throw new CompanyError('VALIDATION', 'Company name is too long.', 400);
  if (input.lifecycleStatus && !statuses.has(input.lifecycleStatus))
    throw new CompanyError('VALIDATION', 'Choose a valid lifecycle status.', 400);
  const tags = [...new Set((input.tags ?? []).map((tag) => tag.trim()).filter(Boolean))];
  if (tags.some((tag) => tag.length > 60))
    throw new CompanyError('VALIDATION', 'Tags must be 60 characters or fewer.', 400);
  return {
    ...input,
    name: input.name.trim(),
    externalReference: input.externalReference?.trim() || null,
    tags,
  };
}
export class CompanyError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export function listCompanies(
  db: Database.Database,
  organizationId: string,
  query: URLSearchParams,
) {
  const page = Math.max(1, Number(query.get('page') ?? '1') || 1),
    pageSize = Math.min(100, Math.max(1, Number(query.get('pageSize') ?? '25') || 25));
  const sort = [
    'name',
    'created_at',
    'updated_at',
    'lifecycle_status',
    'industry',
    'size',
  ].includes(query.get('sort') ?? '')
    ? query.get('sort')!
    : 'name';
  const direction = query.get('direction') === 'desc' ? 'DESC' : 'ASC';
  const clauses = ['organization_id = ?'];
  const values: unknown[] = [organizationId];
  if (query.get('includeArchived') !== 'true') clauses.push('archived_at IS NULL');
  for (const [key, column] of [
    ['lifecycle', 'lifecycle_status'],
    ['industry', 'industry'],
    ['size', 'size'],
    ['owner', 'owner_membership_id'],
  ] as const)
    if (query.get(key)) {
      clauses.push(`${column} = ?`);
      values.push(query.get(key));
    }
  if (query.get('tag')) {
    clauses.push('tags_json LIKE ?');
    values.push(`%${JSON.stringify(query.get('tag'))!.slice(1, -1)}%`);
  }
  if (query.get('q')) {
    clauses.push('(name LIKE ? OR external_reference LIKE ? OR website LIKE ?)');
    values.push(...Array(3).fill(`%${query.get('q')!.trim()}%`));
  }
  const where = clauses.join(' AND ');
  const total = (
    db.prepare(`SELECT count(*) AS count FROM companies WHERE ${where}`).get(...values) as {
      count: number;
    }
  ).count;
  const items = db
    .prepare(
      `SELECT * FROM companies WHERE ${where} ORDER BY ${sort} ${direction}, id ASC LIMIT ? OFFSET ?`,
    )
    .all(...values, pageSize, (page - 1) * pageSize);
  return { items, page, pageSize, total, totalPages: Math.ceil(total / pageSize) };
}
export function getCompany(db: Database.Database, organizationId: string, id: string) {
  const company = db
    .prepare('SELECT * FROM companies WHERE organization_id = ? AND id = ?')
    .get(organizationId, id);
  if (!company) throw new CompanyError('NOT_FOUND', 'Company not found.', 404);
  return {
    company,
    contacts: db
      .prepare('SELECT * FROM contacts WHERE organization_id=? AND company_id=?')
      .all(organizationId, id),
    activities: db
      .prepare(
        'SELECT * FROM activities WHERE organization_id=? AND company_id=? ORDER BY occurred_at DESC',
      )
      .all(organizationId, id),
    deals: db
      .prepare('SELECT * FROM deals WHERE organization_id=? AND company_id=?')
      .all(organizationId, id),
    tasks: db
      .prepare('SELECT * FROM tasks WHERE organization_id=? AND company_id=?')
      .all(organizationId, id),
  };
}
export function createCompany(
  db: Database.Database,
  organizationId: string,
  defaultOwner: string,
  input: CompanyInput,
) {
  const value = clean(input),
    now = new Date().toISOString(),
    id = randomUUID();
  try {
    db.prepare(
      'INSERT INTO companies (id,organization_id,name,external_reference,website,phone,industry,size,address,lifecycle_status,owner_membership_id,tags_json,description,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    ).run(
      id,
      organizationId,
      value.name,
      value.externalReference,
      value.website?.trim() || null,
      value.phone?.trim() || null,
      value.industry?.trim() || null,
      value.size?.trim() || null,
      value.address?.trim() || null,
      value.lifecycleStatus ?? 'lead',
      value.ownerMembershipId ?? defaultOwner,
      JSON.stringify(value.tags),
      value.description?.trim() || '',
      now,
      now,
    );
    return getCompany(db, organizationId, id).company;
  } catch (error) {
    if (
      String(error).includes(
        'UNIQUE constraint failed: companies.organization_id, companies.external_reference',
      )
    )
      throw new CompanyError('CONFLICT', 'A company already uses this external reference.', 409);
    throw error;
  }
}
export function updateCompany(
  db: Database.Database,
  organizationId: string,
  id: string,
  input: CompanyInput,
  version: number,
) {
  const current = getCompany(db, organizationId, id).company as Record<string, unknown>;
  if (current.version !== version)
    throw new CompanyError(
      'CONFLICT',
      'This company changed elsewhere. Refresh and try again.',
      409,
    );
  const value = clean(input),
    now = new Date().toISOString();
  try {
    const result = db
      .prepare(
        'UPDATE companies SET name=?,external_reference=?,website=?,phone=?,industry=?,size=?,address=?,lifecycle_status=?,owner_membership_id=?,tags_json=?,description=?,updated_at=?,version=version+1 WHERE organization_id=? AND id=? AND version=?',
      )
      .run(
        value.name,
        value.externalReference,
        value.website?.trim() || null,
        value.phone?.trim() || null,
        value.industry?.trim() || null,
        value.size?.trim() || null,
        value.address?.trim() || null,
        value.lifecycleStatus ?? 'lead',
        value.ownerMembershipId ?? current.owner_membership_id,
        JSON.stringify(value.tags),
        value.description?.trim() || '',
        now,
        organizationId,
        id,
        version,
      );
    if (!result.changes)
      throw new CompanyError(
        'CONFLICT',
        'This company changed elsewhere. Refresh and try again.',
        409,
      );
    return getCompany(db, organizationId, id).company;
  } catch (error) {
    if (
      String(error).includes(
        'UNIQUE constraint failed: companies.organization_id, companies.external_reference',
      )
    )
      throw new CompanyError('CONFLICT', 'A company already uses this external reference.', 409);
    throw error;
  }
}
export function archiveCompany(
  db: Database.Database,
  organizationId: string,
  id: string,
  restore = false,
) {
  getCompany(db, organizationId, id);
  db.prepare(
    'UPDATE companies SET archived_at=?, updated_at=?, version=version+1 WHERE organization_id=? AND id=?',
  ).run(restore ? null : new Date().toISOString(), new Date().toISOString(), organizationId, id);
  return getCompany(db, organizationId, id).company;
}
