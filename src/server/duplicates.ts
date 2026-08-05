import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { ContactActor } from './contacts.js';

export type DuplicateResource = 'company' | 'contact';
type Actor = ContactActor;
export class DuplicateError extends Error {
  constructor(
    public readonly code: 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT' | 'VALIDATION',
    message: string,
  ) {
    super(message);
  }
}
const companyFields = [
  'name',
  'external_reference',
  'website',
  'phone',
  'industry',
  'size',
  'address',
  'lifecycle_status',
  'owner_membership_id',
  'tags_json',
  'description',
] as const;
const contactFields = [
  'first_name',
  'last_name',
  'email',
  'phone',
  'job_title',
  'owner_membership_id',
  'status',
  'tags_json',
  'communication_preference',
  'company_id',
] as const;
type MergeInput = {
  resource: DuplicateResource;
  survivorId: string;
  retiredId: string;
  survivorVersion: number;
  resolvedFields: Record<string, unknown>;
};
function writer(actor: Actor) {
  if (actor.role === 'viewer') throw new DuplicateError('FORBIDDEN', 'Viewer access is read only.');
}
function table(resource: DuplicateResource) {
  return resource === 'company' ? 'companies' : 'contacts';
}
function archiveColumn(resource: DuplicateResource) {
  return 'archived_at';
}
function normalize(value: string | null | undefined) {
  return (value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}
function row(db: Database.Database, actor: Actor, resource: DuplicateResource, id: string) {
  const value = db
    .prepare(`SELECT * FROM ${table(resource)} WHERE organization_id=? AND id=?`)
    .get(actor.organizationId, id) as Record<string, unknown> | undefined;
  if (!value)
    throw new DuplicateError(
      'NOT_FOUND',
      `${resource === 'company' ? 'Company' : 'Contact'} not found.`,
    );
  return value;
}
function writeAudit(
  db: Database.Database,
  actor: Actor,
  action: string,
  resource: DuplicateResource,
  id: string,
  summary: unknown,
  now: string,
) {
  db.prepare(
    'INSERT INTO audit_events (id,organization_id,actor_membership_id,action,entity_type,entity_id,change_summary_json,created_at) VALUES (?,?,?,?,?,?,?,?)',
  ).run(
    randomUUID(),
    actor.organizationId,
    actor.membershipId,
    action,
    resource,
    id,
    JSON.stringify(summary),
    now,
  );
}
function differences(
  resource: DuplicateResource,
  survivor: Record<string, unknown>,
  retired: Record<string, unknown>,
) {
  const fields = resource === 'company' ? companyFields : contactFields;
  return fields.filter((field) => String(survivor[field] ?? '') !== String(retired[field] ?? ''));
}
function validateResolution(
  resource: DuplicateResource,
  survivor: Record<string, unknown>,
  retired: Record<string, unknown>,
  supplied: Record<string, unknown>,
) {
  const changed = differences(resource, survivor, retired);
  if (changed.some((field) => !(field in supplied)))
    throw new DuplicateError(
      'VALIDATION',
      'Select a value for every conflicting field before merging.',
    );
  const allowed = new Set(resource === 'company' ? companyFields : contactFields);
  for (const field of Object.keys(supplied))
    if (!allowed.has(field as never))
      throw new DuplicateError('VALIDATION', 'A merge field is not supported.');
  return changed;
}
export function resolveRetiredId(
  db: Database.Database,
  actor: Actor,
  resource: DuplicateResource,
  id: string,
) {
  let current = id;
  const seen = new Set<string>();
  while (true) {
    if (seen.has(current)) throw new DuplicateError('CONFLICT', 'This merge redirect is invalid.');
    seen.add(current);
    const redirect = db
      .prepare(
        'SELECT target_id FROM merge_redirects WHERE organization_id=? AND resource=? AND source_id=?',
      )
      .get(actor.organizationId, resource, current) as { target_id: string } | undefined;
    if (!redirect) return current;
    current = redirect.target_id;
  }
}
export function duplicateCandidates(
  db: Database.Database,
  actor: Actor,
  resource: DuplicateResource,
  id: string,
) {
  const subject = row(db, actor, resource, id);
  const retired = subject.archived_at !== null;
  const all = db
    .prepare(`SELECT * FROM ${table(resource)} WHERE organization_id=? AND id<>?`)
    .all(actor.organizationId, id) as Record<string, unknown>[];
  const facts =
    resource === 'company'
      ? [
          { key: 'name', value: normalize(subject.name as string) },
          { key: 'externalReference', value: normalize(subject.external_reference as string) },
          { key: 'website', value: normalize(subject.website as string) },
        ]
      : [
          { key: 'email', value: normalize(subject.email as string) },
          { key: 'name', value: normalize(`${subject.first_name} ${subject.last_name}`) },
          { key: 'phone', value: normalize(subject.phone as string) },
        ];
  return all.flatMap((candidate) => {
    const candidateFacts =
      resource === 'company'
        ? {
            name: normalize(candidate.name as string),
            externalReference: normalize(candidate.external_reference as string),
            website: normalize(candidate.website as string),
          }
        : {
            email: normalize(candidate.email as string),
            name: normalize(`${candidate.first_name} ${candidate.last_name}`),
            phone: normalize(candidate.phone as string),
          };
    const triggers = facts
      .filter(
        (fact) =>
          fact.value && candidateFacts[fact.key as keyof typeof candidateFacts] === fact.value,
      )
      .map((fact) => ({ field: fact.key, normalizedValue: fact.value }));
    return triggers.length
      ? [
          {
            id: candidate.id,
            archived: candidate.archived_at !== null,
            triggers,
            fieldsRequiringResolution: differences(resource, subject, candidate),
          },
        ]
      : [];
  });
}
export class DuplicateService {
  constructor(
    private readonly db: Database.Database,
    private readonly now = () => new Date().toISOString(),
  ) {}
  candidates(actor: Actor, resource: DuplicateResource, id: string) {
    return duplicateCandidates(this.db, actor, resource, id);
  }
  resolve(actor: Actor, resource: DuplicateResource, id: string) {
    return resolveRetiredId(this.db, actor, resource, id);
  }
  merge(actor: Actor, input: MergeInput) {
    writer(actor);
    if (input.survivorId === input.retiredId)
      throw new DuplicateError('VALIDATION', 'Choose two different records to merge.');
    const now = this.now();
    const resource = input.resource;
    this.db.transaction(() => {
      const survivor = row(this.db, actor, resource, input.survivorId);
      const retired = row(this.db, actor, resource, input.retiredId);
      if (survivor.archived_at !== null)
        throw new DuplicateError('VALIDATION', 'The survivor must be an active record.');
      if (survivor.version !== input.survivorVersion)
        throw new DuplicateError(
          'CONFLICT',
          'The survivor changed elsewhere. Refresh and review before merging.',
        );
      if (
        this.db
          .prepare(
            'SELECT 1 FROM merge_redirects WHERE organization_id=? AND resource=? AND source_id=?',
          )
          .get(actor.organizationId, resource, input.retiredId)
      )
        throw new DuplicateError('CONFLICT', 'This retired record has already been merged.');
      const changed = validateResolution(resource, survivor, retired, input.resolvedFields);
      const fields = resource === 'company' ? companyFields : contactFields;
      const values = fields.map((field) =>
        changed.includes(field as never) ? input.resolvedFields[field] : survivor[field],
      );
      const assignments = fields.map((field) => `${field}=?`).join(',');
      this.db
        .prepare(
          `UPDATE ${table(resource)} SET ${assignments},updated_at=?,version=version+1 WHERE organization_id=? AND id=? AND version=?`,
        )
        .run(...values, now, actor.organizationId, input.survivorId, input.survivorVersion);
      if (resource === 'company') {
        for (const column of ['company_id'])
          for (const target of ['contacts', 'activities', 'deals', 'tasks'])
            this.db
              .prepare(`UPDATE ${target} SET ${column}=? WHERE organization_id=? AND ${column}=?`)
              .run(input.survivorId, actor.organizationId, input.retiredId);
      } else {
        for (const target of ['activities', 'tasks'])
          this.db
            .prepare(`UPDATE ${target} SET contact_id=? WHERE organization_id=? AND contact_id=?`)
            .run(input.survivorId, actor.organizationId, input.retiredId);
        this.db
          .prepare(
            'INSERT OR IGNORE INTO deal_contacts (organization_id,deal_id,contact_id,created_at) SELECT organization_id,deal_id,?,created_at FROM deal_contacts WHERE organization_id=? AND contact_id=?',
          )
          .run(input.survivorId, actor.organizationId, input.retiredId);
        this.db
          .prepare('DELETE FROM deal_contacts WHERE organization_id=? AND contact_id=?')
          .run(actor.organizationId, input.retiredId);
      }
      this.db
        .prepare(
          `UPDATE ${table(resource)} SET ${archiveColumn(resource)}=?,updated_at=?,version=version+1 WHERE organization_id=? AND id=?`,
        )
        .run(now, now, actor.organizationId, input.retiredId);
      this.db
        .prepare(
          'INSERT INTO merge_redirects (id,organization_id,resource,source_id,target_id,actor_membership_id,created_at) VALUES (?,?,?,?,?,?,?)',
        )
        .run(
          randomUUID(),
          actor.organizationId,
          resource,
          input.retiredId,
          input.survivorId,
          actor.membershipId,
          now,
        );
      writeAudit(
        this.db,
        actor,
        'duplicate.merged',
        resource,
        input.survivorId,
        { retiredId: input.retiredId, resolvedFields: changed },
        now,
      );
    })();
    return {
      survivorId: input.survivorId,
      retiredId: input.retiredId,
      resolvedId: this.resolve(actor, resource, input.retiredId),
    };
  }
}
