import { hash as argonHash, verify as argonVerify } from "@node-rs/argon2";
import type Database from "better-sqlite3";
import {
  createHash,
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { currentCorrelationId } from "../request-context.js";

export type Role = "owner" | "member" | "viewer";

export interface SessionIdentity {
  sessionHash: string;
  userId: string;
  membershipId: string;
  organizationId: string;
  organizationName?: string;
  role: Role;
  email: string;
  displayName: string;
  expiresAt: string;
}

export class AuthenticationError extends Error {}
export class SessionExpiredError extends AuthenticationError {}
export class AuthorizationError extends Error {}
export class MembershipConflictError extends Error {}

const GENERIC_SIGN_IN_ERROR = "The email or password is incorrect.";
const DUMMY_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$MilXVaKmEFoeDIk6cQjtbw$OXYLzUOeI6RiV0cOALKtw69vZZH9DV0gtsqULIz8Iy4";

const iso = (date: Date): string => date.toISOString();
const digest = (token: string): string =>
  createHash("sha256").update(token).digest("hex");

async function verifyPassword(
  encoded: string,
  password: string,
): Promise<boolean> {
  if (encoded.startsWith("scrypt$")) {
    const [, cost, blockSize, parallelism, salt, expectedBase64] =
      encoded.split("$");
    if (!cost || !blockSize || !parallelism || !salt || !expectedBase64)
      return false;
    const expected = Buffer.from(expectedBase64, "base64");
    const actual = scryptSync(password, salt, expected.length, {
      N: Number(cost),
      r: Number(blockSize),
      p: Number(parallelism),
      maxmem: 64 * 1024 * 1024,
    });
    return (
      expected.length === actual.length && timingSafeEqual(expected, actual)
    );
  }
  return argonVerify(encoded, password);
}

export async function hashPassword(password: string): Promise<string> {
  if (password.length < 12 || password.length > 256) {
    throw new Error("Passwords must contain between 12 and 256 characters.");
  }
  return argonHash(password, {
    algorithm: 2, // Argon2id; numeric form is compatible with isolated TypeScript modules.
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

  async signIn(
    email: string,
    password: string,
    organizationId?: string,
  ): Promise<{ token: string; identity: SessionIdentity }> {
    const normalizedEmail = email.trim().toLowerCase();
    const user = this.db
      .prepare(
        `
      SELECT id, email, password_hash AS passwordHash, display_name AS displayName
      FROM users WHERE email = ? COLLATE NOCASE
    `,
      )
      .get(normalizedEmail) as
      | { id: string; email: string; passwordHash: string; displayName: string }
      | undefined;

    let passwordValid: boolean;
    try {
      passwordValid = await verifyPassword(
        user?.passwordHash ?? DUMMY_HASH,
        password,
      );
    } catch {
      passwordValid = false;
    }
    if (!user || !passwordValid)
      throw new AuthenticationError(GENERIC_SIGN_IN_ERROR);

    const membership = this.db
      .prepare(
        `
      SELECT m.id AS membershipId, m.organization_id AS organizationId,
      m.role,o.name AS organizationName FROM memberships m
      JOIN organizations o ON o.id=m.organization_id
      WHERE m.user_id = ? AND m.removed_at IS NULL AND (? IS NULL OR m.organization_id = ?)
      ORDER BY m.organization_id LIMIT 1
    `,
      )
      .get(user.id, organizationId ?? null, organizationId ?? null) as
      | {
          membershipId: string;
          organizationId: string;
          organizationName: string;
          role: Role;
        }
      | undefined;
    if (!membership) throw new AuthenticationError(GENERIC_SIGN_IN_ERROR);

    const token = randomBytes(32).toString("base64url");
    const createdAt = this.now();
    const expiresAt = new Date(createdAt.getTime() + this.sessionLifetimeMs);
    const identity: SessionIdentity = {
      sessionHash: digest(token),
      userId: user.id,
      membershipId: membership.membershipId,
      organizationId: membership.organizationId,
      organizationName: membership.organizationName,
      role: membership.role,
      email: user.email,
      displayName: user.displayName,
      expiresAt: iso(expiresAt),
    };
    this.db
      .transaction(() => {
        this.db
          .prepare(
            `INSERT INTO sessions
            (id,token_hash,user_id,organization_id,created_at,expires_at,last_seen_at)
            VALUES (?,?,?,?,?,?,?)`,
          )
          .run(
            newOpaqueId(),
            identity.sessionHash,
            user.id,
            membership.organizationId,
            iso(createdAt),
            iso(expiresAt),
            iso(createdAt),
          );
        this.audit(identity, "authentication.signed_in", user.id, {}, "user");
      })
      .immediate();

    return { token, identity };
  }

  authenticate(token: string | undefined): SessionIdentity {
    if (!token || token.length > 128)
      throw new AuthenticationError("Authentication required.");
    const row = this.db
      .prepare(
        `
      SELECT s.token_hash AS sessionHash, s.user_id AS userId, m.id AS membershipId,
             s.organization_id AS organizationId, s.expires_at AS expiresAt, m.role,
             u.email, u.display_name AS displayName,o.name AS organizationName
      FROM sessions s
      JOIN memberships m ON m.organization_id = s.organization_id AND m.user_id = s.user_id
      JOIN users u ON u.id = s.user_id
      JOIN organizations o ON o.id = s.organization_id
      WHERE s.token_hash = ? AND s.revoked_at IS NULL AND m.removed_at IS NULL
    `,
      )
      .get(digest(token)) as SessionIdentity | undefined;
    if (!row) throw new AuthenticationError("Authentication required.");
    if (row.expiresAt <= iso(this.now()))
      throw new SessionExpiredError(
        "Your session expired. Sign in again to continue.",
      );
    return row;
  }

  logout(token: string | undefined): void {
    if (!token || token.length > 128) return;
    const tokenHash = digest(token);
    this.db
      .transaction(() => {
        const actor = this.db
          .prepare(
            `SELECT s.user_id AS userId,m.id AS membershipId,
            s.organization_id AS organizationId FROM sessions s
            JOIN memberships m ON m.organization_id=s.organization_id AND m.user_id=s.user_id
            WHERE s.token_hash=? AND s.revoked_at IS NULL`,
          )
          .get(tokenHash) as
          | Pick<SessionIdentity, "userId" | "membershipId" | "organizationId">
          | undefined;
        this.db
          .prepare(
            "UPDATE sessions SET revoked_at = COALESCE(revoked_at, ?) WHERE token_hash = ?",
          )
          .run(iso(this.now()), tokenHash);
        if (actor)
          this.audit(
            actor,
            "authentication.signed_out",
            actor.userId,
            {},
            "user",
          );
      })
      .immediate();
  }

  revokeUserSessions(actor: SessionIdentity, userId: string): void {
    this.requireRole(actor, "owner");
    this.db
      .transaction(() => {
        this.db
          .prepare(
            "UPDATE sessions SET revoked_at = COALESCE(revoked_at, ?) WHERE organization_id = ? AND user_id = ?",
          )
          .run(iso(this.now()), actor.organizationId, userId);
        this.audit(actor, "membership.sessions_revoked", userId, {});
      })
      .immediate();
  }

  requireRole(identity: SessionIdentity, minimum: Role): void {
    const rank: Record<Role, number> = { viewer: 0, member: 1, owner: 2 };
    if (rank[identity.role] < rank[minimum])
      throw new AuthorizationError(
        "You do not have permission to perform this action.",
      );
  }

  assertOrganization(identity: SessionIdentity, organizationId: string): void {
    const left = Buffer.from(identity.organizationId);
    const right = Buffer.from(organizationId);
    if (left.length !== right.length || !timingSafeEqual(left, right)) {
      throw new AuthorizationError("The requested resource was not found.");
    }
  }

  listMemberships(actor: SessionIdentity): Array<{
    membershipId: string;
    userId: string;
    email: string;
    displayName: string;
    role: Role;
  }> {
    this.requireRole(actor, "owner");
    return this.db
      .prepare(
        `
      SELECT m.id AS membershipId, m.user_id AS userId, u.email, u.display_name AS displayName, m.role
      FROM memberships m JOIN users u ON u.id = m.user_id
      WHERE m.organization_id = ? AND m.removed_at IS NULL ORDER BY u.email
    `,
      )
      .all(actor.organizationId) as Array<{
      membershipId: string;
      userId: string;
      email: string;
      displayName: string;
      role: Role;
    }>;
  }

  organization(actor: SessionIdentity) {
    this.requireRole(actor, "owner");
    const organization = this.db
      .prepare(
        "SELECT id,name,slug,version,updated_at AS updatedAt FROM organizations WHERE id=?",
      )
      .get(actor.organizationId);
    return { organization, members: this.listMemberships(actor) };
  }

  async createMember(
    actor: SessionIdentity,
    input: {
      email: string;
      displayName: string;
      password: string;
      role: Exclude<Role, "owner"> | "owner";
    },
  ) {
    this.requireRole(actor, "owner");
    const email = input.email.trim().toLowerCase();
    const displayName = input.displayName.trim();
    if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 254)
      throw new MembershipConflictError("Provide a valid email address.");
    if (!displayName || displayName.length > 100)
      throw new MembershipConflictError("Provide a display name.");
    let passwordHash: string;
    try {
      passwordHash = await hashPassword(input.password);
    } catch {
      throw new MembershipConflictError(
        "Passwords must contain between 12 and 256 characters.",
      );
    }
    const timestamp = iso(this.now());
    const userId = `user_${newOpaqueId()}`;
    const membershipId = `membership_${newOpaqueId()}`;
    try {
      this.db
        .transaction(() => {
          this.db
            .prepare(
              `INSERT INTO users
              (id,email,password_hash,display_name,created_at,updated_at)
              VALUES (?,?,?,?,?,?)`,
            )
            .run(
              userId,
              email,
              passwordHash,
              displayName,
              timestamp,
              timestamp,
            );
          this.db
            .prepare(
              `INSERT INTO memberships
              (id,organization_id,user_id,role,created_at,updated_at)
              VALUES (?,?,?,?,?,?)`,
            )
            .run(
              membershipId,
              actor.organizationId,
              userId,
              input.role,
              timestamp,
              timestamp,
            );
          this.audit(actor, "membership.created", userId, {
            role: input.role,
            displayName,
          });
        })
        .immediate();
    } catch (error) {
      if (error instanceof Error && error.message.includes("UNIQUE constraint"))
        throw new MembershipConflictError(
          "A member with those account details already exists.",
        );
      throw error;
    }
    return this.listMemberships(actor).find((item) => item.userId === userId)!;
  }

  updateOrganization(
    actor: SessionIdentity,
    value: { name: string; version: number },
  ) {
    this.requireRole(actor, "owner");
    const name = value.name.trim();
    if (!name || name.length > 120)
      throw new MembershipConflictError(
        "Organization name must contain between 1 and 120 characters.",
      );
    if (!Number.isInteger(value.version) || value.version < 1)
      throw new MembershipConflictError(
        "Organization version is required. Refresh and try again.",
      );
    this.db
      .transaction(() => {
        const current = this.db
          .prepare("SELECT name,version FROM organizations WHERE id=?")
          .get(actor.organizationId) as { name: string; version: number };
        if (current.version !== value.version)
          throw new MembershipConflictError(
            "Organization settings changed. Refresh and try again.",
          );
        this.db
          .prepare(
            "UPDATE organizations SET name=?,updated_at=?,version=version+1 WHERE id=? AND version=?",
          )
          .run(name, iso(this.now()), actor.organizationId, value.version);
        this.audit(
          actor,
          "organization.updated",
          actor.organizationId,
          {
            previousName: current.name,
            name,
          },
          "organization",
        );
      })
      .immediate();
    return this.organization(actor).organization;
  }

  addMembership(
    actor: SessionIdentity,
    input: { userId: string; role: Role },
  ): void {
    this.requireRole(actor, "owner");
    const timestamp = iso(this.now());
    this.db
      .transaction(() => {
        this.db
          .prepare(
            `
        INSERT INTO memberships (id, organization_id, user_id, role, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT (organization_id, user_id) DO UPDATE SET
          role = excluded.role, removed_at = NULL, updated_at = excluded.updated_at,
          version = memberships.version + 1
      `,
          )
          .run(
            newOpaqueId(),
            actor.organizationId,
            input.userId,
            input.role,
            timestamp,
            timestamp,
          );
        this.audit(actor, "membership.added", input.userId, {
          role: input.role,
        });
      })
      .immediate();
  }

  updateMembership(actor: SessionIdentity, userId: string, role: Role): void {
    this.requireRole(actor, "owner");
    this.db
      .transaction(() => {
        const current = this.db
          .prepare(
            "SELECT role FROM memberships WHERE organization_id = ? AND user_id = ? AND removed_at IS NULL",
          )
          .get(actor.organizationId, userId) as { role: Role } | undefined;
        if (!current)
          throw new AuthorizationError("The requested resource was not found.");
        if (current.role === "owner" && role !== "owner")
          this.assertAnotherOwner(actor.organizationId, userId);
        this.db
          .prepare(
            "UPDATE memberships SET role = ?, updated_at = ?, version = version + 1 WHERE organization_id = ? AND user_id = ?",
          )
          .run(role, iso(this.now()), actor.organizationId, userId);
        if (role === "viewer") this.revokeUserSessions(actor, userId);
        this.audit(actor, "membership.role_updated", userId, {
          previousRole: current.role,
          role,
        });
      })
      .immediate();
  }

  removeMembership(actor: SessionIdentity, userId: string): void {
    this.requireRole(actor, "owner");
    this.db
      .transaction(() => {
        const current = this.db
          .prepare(
            "SELECT role FROM memberships WHERE organization_id = ? AND user_id = ? AND removed_at IS NULL",
          )
          .get(actor.organizationId, userId) as { role: Role } | undefined;
        if (!current)
          throw new AuthorizationError("The requested resource was not found.");
        if (current.role === "owner")
          this.assertAnotherOwner(actor.organizationId, userId);
        const timestamp = iso(this.now());
        this.db
          .prepare(
            "UPDATE sessions SET revoked_at = COALESCE(revoked_at, ?) WHERE organization_id = ? AND user_id = ?",
          )
          .run(timestamp, actor.organizationId, userId);
        this.db
          .prepare(
            "UPDATE memberships SET removed_at = ?, updated_at = ?, version = version + 1 WHERE organization_id = ? AND user_id = ?",
          )
          .run(timestamp, timestamp, actor.organizationId, userId);
        this.audit(actor, "membership.removed", userId, {
          previousRole: current.role,
        });
      })
      .immediate();
  }

  private assertAnotherOwner(
    organizationId: string,
    excludedUserId: string,
  ): void {
    const another = this.db
      .prepare(
        `
      SELECT 1 FROM memberships WHERE organization_id = ? AND role = 'owner' AND removed_at IS NULL AND user_id <> ? LIMIT 1
    `,
      )
      .get(organizationId, excludedUserId);
    if (!another)
      throw new MembershipConflictError(
        "An organization must always have at least one owner.",
      );
  }

  private audit(
    actor: Pick<SessionIdentity, "organizationId" | "membershipId">,
    action: string,
    entityId: string,
    summary: Record<string, unknown>,
    entityType = "membership",
  ): void {
    this.db
      .prepare(
        `
      INSERT INTO audit_events (id, organization_id, actor_membership_id, action, entity_type, entity_id, summary_json, occurred_at, correlation_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        newOpaqueId(),
        actor.organizationId,
        actor.membershipId,
        action,
        entityType,
        entityId,
        JSON.stringify(summary),
        iso(this.now()),
        currentCorrelationId(),
      );
  }
}

export function newOpaqueId(): string {
  return randomUUID();
}
