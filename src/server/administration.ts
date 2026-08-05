import { randomUUID } from 'node:crypto';
import { hashSync } from 'bcryptjs';
import type Database from 'better-sqlite3';
import { appendAudit, type AuditActor } from './audit.js';

export class AdministrationError extends Error {
  constructor(
    public code: 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT' | 'VALIDATION',
    message: string,
  ) {
    super(message);
  }
}
function owner(actor: AuditActor) {
  if (actor.role !== 'owner')
    throw new AdministrationError('FORBIDDEN', 'Only organization owners can administer members.');
}
const roles = new Set(['owner', 'member', 'viewer']);
export class AdministrationService {
  constructor(
    private db: Database.Database,
    private now = () => new Date().toISOString(),
  ) {}
  list(actor: AuditActor) {
    owner(actor);
    return this.db
      .prepare(
        'SELECT m.id,u.id AS userId,u.email,u.display_name AS displayName,m.role,m.created_at AS createdAt FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.organization_id=? ORDER BY u.email',
      )
      .all(actor.organizationId);
  }
  invite(
    actor: AuditActor,
    input: { email: string; displayName?: string; password: string; role: string },
  ) {
    owner(actor);
    const email = input.email.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email) || input.password.length < 12 || !roles.has(input.role))
      throw new AdministrationError('VALIDATION', 'Enter a valid email, password, and role.');
    const now = this.now(),
      userId = randomUUID(),
      membershipId = randomUUID();
    try {
      this.db.transaction(() => {
        this.db
          .prepare(
            'INSERT INTO users (id,email,display_name,password_hash,created_at,updated_at) VALUES (?,?,?,?,?,?)',
          )
          .run(
            userId,
            email,
            input.displayName?.trim() || email,
            hashSync(input.password, 12),
            now,
            now,
          );
        this.db
          .prepare(
            'INSERT INTO memberships (id,organization_id,user_id,role,created_at,updated_at) VALUES (?,?,?,?,?,?)',
          )
          .run(membershipId, actor.organizationId, userId, input.role, now, now);
        appendAudit(this.db, actor, 'member.invited', 'membership', membershipId, {
          email,
          role: input.role,
        });
      })();
    } catch (error) {
      if (String(error).includes('UNIQUE'))
        throw new AdministrationError('CONFLICT', 'That email is already a member.');
      throw error;
    }
    return { id: membershipId, userId, email, role: input.role };
  }
  changeRole(actor: AuditActor, membershipId: string, role: string) {
    owner(actor);
    if (!roles.has(role)) throw new AdministrationError('VALIDATION', 'Choose a permitted role.');
    const member = this.db
      .prepare('SELECT user_id,role FROM memberships WHERE id=? AND organization_id=?')
      .get(membershipId, actor.organizationId) as { user_id: string; role: string } | undefined;
    if (!member) throw new AdministrationError('NOT_FOUND', 'Member not found.');
    if (
      member.role === 'owner' &&
      role !== 'owner' &&
      (
        this.db
          .prepare(
            "SELECT count(*) AS count FROM memberships WHERE organization_id=? AND role='owner'",
          )
          .get(actor.organizationId) as { count: number }
      ).count <= 1
    )
      throw new AdministrationError('CONFLICT', 'An organization must retain at least one owner.');
    this.db
      .prepare(
        'UPDATE memberships SET role=?,updated_at=?,version=version+1 WHERE id=? AND organization_id=?',
      )
      .run(role, this.now(), membershipId, actor.organizationId);
    this.db
      .prepare(
        'UPDATE sessions SET revoked_at=? WHERE organization_id=? AND user_id=? AND revoked_at IS NULL',
      )
      .run(this.now(), actor.organizationId, member.user_id);
    appendAudit(this.db, actor, 'member.role_changed', 'membership', membershipId, { role });
  }
  revoke(actor: AuditActor, membershipId: string) {
    owner(actor);
    if (membershipId === actor.membershipId)
      throw new AdministrationError(
        'CONFLICT',
        'Owners cannot revoke their own active membership.',
      );
    const member = this.db
      .prepare('SELECT user_id,role FROM memberships WHERE id=? AND organization_id=?')
      .get(membershipId, actor.organizationId) as { user_id: string; role: string } | undefined;
    if (!member) throw new AdministrationError('NOT_FOUND', 'Member not found.');
    if (
      member.role === 'owner' &&
      (
        this.db
          .prepare(
            "SELECT count(*) AS count FROM memberships WHERE organization_id=? AND role='owner'",
          )
          .get(actor.organizationId) as { count: number }
      ).count <= 1
    )
      throw new AdministrationError('CONFLICT', 'An organization must retain at least one owner.');
    this.db.transaction(() => {
      this.db
        .prepare(
          'UPDATE sessions SET revoked_at=? WHERE organization_id=? AND user_id=? AND revoked_at IS NULL',
        )
        .run(this.now(), actor.organizationId, member.user_id);
      this.db
        .prepare('DELETE FROM memberships WHERE id=? AND organization_id=?')
        .run(membershipId, actor.organizationId);
      appendAudit(this.db, actor, 'member.revoked', 'membership', membershipId, {});
    })();
  }
  updateOrganization(actor: AuditActor, name: string) {
    owner(actor);
    const value = name.trim();
    if (!value || value.length > 180)
      throw new AdministrationError(
        'VALIDATION',
        'Enter an organization name up to 180 characters.',
      );
    this.db
      .prepare('UPDATE organizations SET name=?,updated_at=?,version=version+1 WHERE id=?')
      .run(value, this.now(), actor.organizationId);
    appendAudit(this.db, actor, 'organization.updated', 'organization', actor.organizationId, {
      name: value,
    });
  }
}
