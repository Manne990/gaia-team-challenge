import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';

const PASSWORD_BYTES = 64;
const SCRYPT_OPTIONS = { N: 16_384, r: 8, p: 1, maxmem: 32 * 1024 * 1024 };
const DUMMY_HASH =
  'scrypt$0123456789abcdef0123456789abcdef$' +
  scryptSync(
    'not-a-password',
    '0123456789abcdef0123456789abcdef',
    PASSWORD_BYTES,
    SCRYPT_OPTIONS,
  ).toString('hex');

export class AuthError extends Error {
  constructor(code, message = 'Authentication is required.') {
    super(message);
    this.code = code;
  }
}

const nowIso = (clock) => clock().toISOString();
const tokenHash = (token) => createHash('sha256').update(token).digest('hex');

export function hashPassword(password) {
  if (typeof password !== 'string' || password.length < 8)
    throw new AuthError('INVALID_PASSWORD', 'Password must contain at least 8 characters.');
  const salt = randomBytes(16).toString('hex');
  const digest = scryptSync(password, salt, PASSWORD_BYTES, SCRYPT_OPTIONS).toString('hex');
  return `scrypt$${salt}$${digest}`;
}

export function verifyPassword(password, encoded) {
  if (typeof password !== 'string' || typeof encoded !== 'string') return false;
  const [, salt, digest] = encoded.split('$');
  if (!salt || !digest || !/^[a-f0-9]+$/i.test(salt) || !/^[a-f0-9]+$/i.test(digest)) return false;
  const expected = Buffer.from(digest, 'hex');
  const actual = scryptSync(password, salt, expected.length || PASSWORD_BYTES, SCRYPT_OPTIONS);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function createAuthService(
  db,
  { clock = () => new Date(), sessionLifetimeMs = 1000 * 60 * 60 * 24 * 14 } = {},
) {
  const invalidCredentials = () =>
    new AuthError('INVALID_CREDENTIALS', 'Email or password is incorrect.');

  function createSession(user, membership) {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(clock().getTime() + sessionLifetimeMs).toISOString();
    db.prepare(
      'INSERT INTO sessions (id, user_id, organization_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(
      `ses_${randomUUID()}`,
      user.id,
      membership.organization_id,
      tokenHash(token),
      expiresAt,
      nowIso(clock),
    );
    return {
      token,
      expiresAt,
      user: { id: user.id, email: user.email, displayName: user.display_name },
      organizationId: membership.organization_id,
      role: membership.role,
    };
  }

  function signIn({ email, password, organizationId } = {}) {
    const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
    const user = normalizedEmail
      ? db
          .prepare('SELECT id, email, password_hash, display_name FROM users WHERE email = ?')
          .get(normalizedEmail)
      : undefined;
    if (
      !verifyPassword(
        typeof password === 'string' ? password : '',
        user?.password_hash || DUMMY_HASH,
      )
    )
      throw invalidCredentials();
    const memberships = db
      .prepare(
        'SELECT organization_id, role FROM memberships WHERE user_id = ? ORDER BY organization_id',
      )
      .all(user.id);
    const membership = organizationId
      ? memberships.find((item) => item.organization_id === organizationId)
      : memberships[0];
    if (!membership) throw invalidCredentials();
    return createSession(user, membership);
  }

  function authenticate(token) {
    if (typeof token !== 'string' || token.length < 20) throw new AuthError('UNAUTHENTICATED');
    const session = db
      .prepare(
        `SELECT sessions.id, sessions.user_id, sessions.organization_id, sessions.expires_at, sessions.revoked_at,
      users.email, users.display_name, memberships.role
      FROM sessions JOIN users ON users.id = sessions.user_id
      JOIN memberships ON memberships.user_id = sessions.user_id AND memberships.organization_id = sessions.organization_id
      WHERE sessions.token_hash = ?`,
      )
      .get(tokenHash(token));
    if (!session || session.revoked_at) throw new AuthError('UNAUTHENTICATED');
    if (Date.parse(session.expires_at) <= clock().getTime())
      throw new AuthError('SESSION_EXPIRED', 'Your session has expired. Please sign in again.');
    return {
      sessionId: session.id,
      userId: session.user_id,
      organizationId: session.organization_id,
      role: session.role,
      user: { id: session.user_id, email: session.email, displayName: session.display_name },
    };
  }

  function logout(token) {
    if (typeof token === 'string' && token.length >= 20)
      db.prepare(
        'UPDATE sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL',
      ).run(nowIso(clock), tokenHash(token));
  }

  function requireRole(context, roles) {
    if (!context) throw new AuthError('UNAUTHENTICATED');
    if (!roles.includes(context.role))
      throw new AuthError('FORBIDDEN', 'You do not have permission to perform this action.');
    return context;
  }

  function requireOrganization(context, organizationId) {
    if (!context) throw new AuthError('UNAUTHENTICATED');
    if (context.organizationId !== organizationId)
      throw new AuthError('NOT_FOUND', 'This record was not found.');
    return context;
  }

  function listMembers(context) {
    requireRole(context, ['owner']);
    return db
      .prepare(
        `SELECT memberships.id, memberships.user_id AS userId, memberships.role, users.email, users.display_name AS displayName
      FROM memberships JOIN users ON users.id = memberships.user_id WHERE memberships.organization_id = ? ORDER BY users.email`,
      )
      .all(context.organizationId);
  }

  function updateMemberRole(context, membershipId, role) {
    requireRole(context, ['owner']);
    if (!['owner', 'member', 'viewer'].includes(role))
      throw new AuthError('INVALID_ROLE', 'Choose a valid role.');
    const membership = db
      .prepare('SELECT id, user_id, role FROM memberships WHERE id = ? AND organization_id = ?')
      .get(membershipId, context.organizationId);
    if (!membership) throw new AuthError('NOT_FOUND', 'This member was not found.');
    if (
      membership.role === 'owner' &&
      role !== 'owner' &&
      db
        .prepare(
          "SELECT count(*) AS total FROM memberships WHERE organization_id = ? AND role = 'owner'",
        )
        .get(context.organizationId).total <= 1
    ) {
      throw new AuthError('LAST_OWNER', 'An organization must keep at least one owner.');
    }
    db.prepare(
      'UPDATE memberships SET role = ?, updated_at = ?, version = version + 1 WHERE id = ?',
    ).run(role, nowIso(clock), membership.id);
  }

  function removeMember(context, membershipId) {
    requireRole(context, ['owner']);
    const membership = db
      .prepare('SELECT id, role FROM memberships WHERE id = ? AND organization_id = ?')
      .get(membershipId, context.organizationId);
    if (!membership) throw new AuthError('NOT_FOUND', 'This member was not found.');
    if (
      membership.role === 'owner' &&
      db
        .prepare(
          "SELECT count(*) AS total FROM memberships WHERE organization_id = ? AND role = 'owner'",
        )
        .get(context.organizationId).total <= 1
    )
      throw new AuthError('LAST_OWNER', 'An organization must keep at least one owner.');
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const table of ['companies', 'contacts', 'deals']) {
        db.prepare(
          `UPDATE ${table} SET owner_id = NULL, updated_at = ?, version = version + 1 WHERE organization_id = ? AND owner_id = (SELECT user_id FROM memberships WHERE id = ?)`,
        ).run(nowIso(clock), context.organizationId, membership.id);
      }
      db.prepare(
        'UPDATE tasks SET assignee_id = NULL, updated_at = ?, version = version + 1 WHERE organization_id = ? AND assignee_id = (SELECT user_id FROM memberships WHERE id = ?)',
      ).run(nowIso(clock), context.organizationId, membership.id);
      db.prepare(
        'UPDATE activities SET creator_id = NULL WHERE organization_id = ? AND creator_id = (SELECT user_id FROM memberships WHERE id = ?)',
      ).run(context.organizationId, membership.id);
      for (const table of ['notifications', 'saved_views']) {
        db.prepare(
          `DELETE FROM ${table} WHERE organization_id = ? AND user_id = (SELECT user_id FROM memberships WHERE id = ?)`,
        ).run(context.organizationId, membership.id);
      }
      db.prepare(
        'UPDATE sessions SET revoked_at = ? WHERE user_id = (SELECT user_id FROM memberships WHERE id = ?) AND organization_id = ? AND revoked_at IS NULL',
      ).run(nowIso(clock), membership.id, context.organizationId);
      db.prepare('DELETE FROM memberships WHERE id = ?').run(membership.id);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  return {
    signIn,
    authenticate,
    logout,
    requireRole,
    requireOrganization,
    listMembers,
    updateMemberRole,
    removeMember,
  };
}
