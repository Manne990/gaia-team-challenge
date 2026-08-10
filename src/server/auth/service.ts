import { hash as argonHash, verify as argonVerify, Algorithm } from "@node-rs/argon2";
import type Database from "better-sqlite3";
import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";

export type Role = "owner" | "member" | "viewer";

export interface SessionIdentity {
  sessionHash: string;
  userId: string;
  membershipId: string;
  organizationId: string;
  role: Role;
  email: string;
  displayName: string;
  expiresAt: string;
}

export class AuthenticationError extends Error {}
export class AuthorizationError extends Error {}
export class MembershipConflictError extends Error {}

const GENERIC_SIGN_IN_ERROR = "The email or password is incorrect.";
const DUMMY_HASH = "$argon2id$v=19$m=19456,t=2,p=1$bm9ydGhzdGFyLWR1bW15LTEyMw$Kz+sx0bQGLX+PdT1f55pCmTmZa43r0xrh06PBnoD+eM";

const iso = (date: Date): string => date.toISOString();
const digest = (token: string): string => createHash("sha256").update(token).digest("hex");

async function verifyPassword(encoded: string, password: string): Promise<boolean> {
  if (encoded.startsWith("scrypt$")) {
    const [, cost, blockSize, parallelism, salt, expectedBase64] = encoded.split("$");
    if (!cost || !blockSize || !parallelism || !salt || !expectedBase64) return false;
    const expected = Buffer.from(expectedBase64, "base64");
    const actual = scryptSync(password, salt, expected.length, {
      N: Number(cost), r: Number(blockSize), p: Number(parallelism), maxmem: 64 * 1024 * 1024,
    });
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }
  return argonVerify(encoded, password);
}

export async function hashPassword(password: string): Promise<string> {
  if (password.length < 12 || password.length > 256) {
    throw new Error("Passwords must contain between 12 and 256 characters.");
  }
  return argonHash(password, {
    algorithm: Algorithm.Argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
    outputLen: 32,
  });
}

export class AuthService {
  constructor(
    private readonly db: Database.Database,
    private readonly now: () => Date = () => new Date(),
    private readonly sessionLifetimeMs = 8 * 60 * 60 * 1000,
  ) {}

  async signIn(email: string, password: string, organizationId?: string): Promise<{ token: string; identity: SessionIdentity }> {
    const normalizedEmail = email.trim().toLowerCase();
    const user = this.db.prepare(`
      SELECT id, email, password_hash AS passwordHash, display_name AS displayName
      FROM users WHERE email = ? COLLATE NOCASE
    `).get(normalizedEmail) as { id: string; email: string; passwordHash: string; displayName: string } | undefined;

    let passwordValid = false;
    try {
      passwordValid = await verifyPassword(user?.passwordHash ?? DUMMY_HASH, password);
    } catch {
      passwordValid = false;
    }
    if (!user || !passwordValid) throw new AuthenticationError(GENERIC_SIGN_IN_ERROR);

    const membership = this.db.prepare(`
      SELECT id AS membershipId, organization_id AS organizationId, role FROM memberships
      WHERE user_id = ? AND (? IS NULL OR organization_id = ?)
      ORDER BY organization_id LIMIT 1
    `).get(user.id, organizationId ?? null, organizationId ?? null) as { membershipId: string; organizationId: string; role: Role } | undefined;
    if (!membership) throw new AuthenticationError(GENERIC_SIGN_IN_ERROR);

    const token = randomBytes(32).toString("base64url");
    const createdAt = this.now();
    const expiresAt = new Date(createdAt.getTime() + this.sessionLifetimeMs);
    this.db.prepare(`
      INSERT INTO sessions (id, token_hash, user_id, organization_id, created_at, expires_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(newOpaqueId(), digest(token), user.id, membership.organizationId, iso(createdAt), iso(expiresAt), iso(createdAt));

    return {
      token,
      identity: {
        sessionHash: digest(token), userId: user.id, membershipId: membership.membershipId, organizationId: membership.organizationId,
        role: membership.role, email: user.email, displayName: user.displayName, expiresAt: iso(expiresAt),
      },
    };
  }

  authenticate(token: string | undefined): SessionIdentity {
    if (!token || token.length > 128) throw new AuthenticationError("Authentication required.");
    const row = this.db.prepare(`
      SELECT s.token_hash AS sessionHash, s.user_id AS userId, m.id AS membershipId,
             s.organization_id AS organizationId, s.expires_at AS expiresAt, m.role,
             u.email, u.display_name AS displayName
      FROM sessions s
      JOIN memberships m ON m.organization_id = s.organization_id AND m.user_id = s.user_id
      JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ?
    `).get(digest(token), iso(this.now())) as SessionIdentity | undefined;
    if (!row) throw new AuthenticationError("Authentication required.");
    return row;
  }

  logout(token: string | undefined): void {
    if (!token || token.length > 128) return;
    this.db.prepare("UPDATE sessions SET revoked_at = COALESCE(revoked_at, ?) WHERE token_hash = ?")
      .run(iso(this.now()), digest(token));
  }

  revokeUserSessions(actor: SessionIdentity, userId: string): void {
    this.requireRole(actor, "owner");
    this.db.prepare("UPDATE sessions SET revoked_at = COALESCE(revoked_at, ?) WHERE organization_id = ? AND user_id = ?")
      .run(iso(this.now()), actor.organizationId, userId);
  }

  requireRole(identity: SessionIdentity, minimum: Role): void {
    const rank: Record<Role, number> = { viewer: 0, member: 1, owner: 2 };
    if (rank[identity.role] < rank[minimum]) throw new AuthorizationError("You do not have permission to perform this action.");
  }

  assertOrganization(identity: SessionIdentity, organizationId: string): void {
    const left = Buffer.from(identity.organizationId);
    const right = Buffer.from(organizationId);
    if (left.length !== right.length || !timingSafeEqual(left, right)) {
      throw new AuthorizationError("The requested resource was not found.");
    }
  }

  listMemberships(actor: SessionIdentity): Array<{ userId: string; email: string; displayName: string; role: Role }> {
    this.requireRole(actor, "owner");
    return this.db.prepare(`
      SELECT m.user_id AS userId, u.email, u.display_name AS displayName, m.role
      FROM memberships m JOIN users u ON u.id = m.user_id
      WHERE m.organization_id = ? ORDER BY u.email
    `).all(actor.organizationId) as Array<{ userId: string; email: string; displayName: string; role: Role }>;
  }

  addMembership(actor: SessionIdentity, input: { userId: string; role: Role }): void {
    this.requireRole(actor, "owner");
    const timestamp = iso(this.now());
    this.db.prepare(`INSERT INTO memberships (id, organization_id, user_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(newOpaqueId(), actor.organizationId, input.userId, input.role, timestamp, timestamp);
  }

  updateMembership(actor: SessionIdentity, userId: string, role: Role): void {
    this.requireRole(actor, "owner");
    this.db.transaction(() => {
      const current = this.db.prepare("SELECT role FROM memberships WHERE organization_id = ? AND user_id = ?")
        .get(actor.organizationId, userId) as { role: Role } | undefined;
      if (!current) throw new AuthorizationError("The requested resource was not found.");
      if (current.role === "owner" && role !== "owner") this.assertAnotherOwner(actor.organizationId, userId);
      this.db.prepare("UPDATE memberships SET role = ?, updated_at = ?, version = version + 1 WHERE organization_id = ? AND user_id = ?")
        .run(role, iso(this.now()), actor.organizationId, userId);
      if (role === "viewer") this.revokeUserSessions(actor, userId);
    })();
  }

  removeMembership(actor: SessionIdentity, userId: string): void {
    this.requireRole(actor, "owner");
    this.db.transaction(() => {
      const current = this.db.prepare("SELECT role FROM memberships WHERE organization_id = ? AND user_id = ?")
        .get(actor.organizationId, userId) as { role: Role } | undefined;
      if (!current) throw new AuthorizationError("The requested resource was not found.");
      if (current.role === "owner") this.assertAnotherOwner(actor.organizationId, userId);
      this.db.prepare("DELETE FROM memberships WHERE organization_id = ? AND user_id = ?")
        .run(actor.organizationId, userId);
    })();
  }

  private assertAnotherOwner(organizationId: string, excludedUserId: string): void {
    const another = this.db.prepare(`
      SELECT 1 FROM memberships WHERE organization_id = ? AND role = 'owner' AND user_id <> ? LIMIT 1
    `).get(organizationId, excludedUserId);
    if (!another) throw new MembershipConflictError("An organization must always have at least one owner.");
  }
}

export function newOpaqueId(): string {
  return randomUUID();
}
