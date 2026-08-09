import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createAuthService,
  AuthError,
  hashPassword,
  verifyPassword,
} from '../src/auth/service.mjs';
import { resetAndSeed } from '../src/db/database.mjs';

const folder = mkdtempSync(join(tmpdir(), 'northstar-auth-'));
const filename = join(folder, 'crm.sqlite');
const authError = (fn, code) =>
  assert.throws(fn, (error) => error instanceof AuthError && error.code === code);
try {
  const db = resetAndSeed(filename);
  const auth = createAuthService(db, {
    clock: () => new Date('2026-01-15T12:00:00.000Z'),
    sessionLifetimeMs: 60_000,
  });
  const owner = auth.signIn({ email: 'owner@northstar.test', password: 'OwnerPass!2026' });
  const member = auth.signIn({ email: 'member@northstar.test', password: 'MemberPass!2026' });
  const viewer = auth.signIn({ email: 'viewer@northstar.test', password: 'ViewerPass!2026' });
  assert.equal(auth.authenticate(owner.token).role, 'owner');
  assert.equal(auth.authenticate(member.token).role, 'member');
  assert.equal(auth.authenticate(viewer.token).role, 'viewer');
  authError(
    () => auth.signIn({ email: 'owner@northstar.test', password: 'wrong password' }),
    'INVALID_CREDENTIALS',
  );
  authError(
    () => auth.signIn({ email: 'missing@northstar.test', password: 'wrong password' }),
    'INVALID_CREDENTIALS',
  );
  authError(
    () => auth.requireRole(auth.authenticate(viewer.token), ['owner', 'member']),
    'FORBIDDEN',
  );
  authError(
    () => auth.requireOrganization(auth.authenticate(owner.token), 'org_outside'),
    'NOT_FOUND',
  );
  authError(() => auth.listMembers(auth.authenticate(member.token)), 'FORBIDDEN');
  authError(() => auth.removeMember(auth.authenticate(owner.token), 'mem_owner'), 'LAST_OWNER');
  auth.logout(owner.token);
  authError(() => auth.authenticate(owner.token), 'UNAUTHENTICATED');
  const first = hashPassword('A long enough password');
  const second = hashPassword('A long enough password');
  assert.notEqual(first, second, 'password salts must be random');
  assert.equal(verifyPassword('A long enough password', first), true);
  assert.equal(verifyPassword('wrong password', first), false);
  db.close();
  console.log('authentication checks: PASS');
} finally {
  rmSync(folder, { recursive: true, force: true });
}
