import { compare, hash } from "bcryptjs";
import { randomBytes } from "node:crypto";

export const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;

export type Role = "owner" | "member" | "viewer";
export type AuthenticatedUser = Readonly<{
  userId: string;
  organizationId: string;
  role: Role;
  email: string;
}>;

export type AuthUser = Readonly<{ id: string; email: string; passwordHash: string }>;
export type Membership = Readonly<{ userId: string; organizationId: string; role: Role }>;
export type StoredSession = Readonly<{
  id: string;
  userId: string;
  organizationId: string;
  expiresAt: Date;
  revokedAt: Date | null;
}>;

/**
 * Persistence boundary for authentication. The SQLite implementation belongs
 * behind this port: callers never supply an organization ID to authenticate.
 */
export interface AuthStore {
  findUserByEmail(email: string): Promise<AuthUser | null>;
  findUserById(userId: string): Promise<Pick<AuthUser, "email"> | null>;
  findMembership(userId: string, organizationId?: string): Promise<Membership | null>;
  createSession(session: StoredSession): Promise<void>;
  findSession(id: string): Promise<StoredSession | null>;
  revokeSession(id: string, revokedAt: Date): Promise<void>;
  listMemberships(userId: string): Promise<Membership[]>;
  listMembershipsForOrganization(organizationId: string): Promise<Membership[]>;
  removeMembership(userId: string, organizationId: string): Promise<void>;
}

export class AuthenticationError extends Error {
  constructor() {
    // Do not distinguish an unknown account from a wrong password.
    super("Invalid email or password.");
    this.name = "AuthenticationError";
  }
}

export class AuthorizationError extends Error {
  constructor(message = "You do not have permission to perform this action.") {
    super(message);
    this.name = "AuthorizationError";
  }
}

export type Clock = () => Date;

export class AuthService {
  constructor(private readonly store: AuthStore, private readonly now: Clock = () => new Date()) {}

  async signIn(email: string, password: string): Promise<{ token: string; session: StoredSession }> {
    const normalizedEmail = email.trim().toLowerCase();
    const user = await this.store.findUserByEmail(normalizedEmail);
    const passwordMatches = user ? await compare(password, user.passwordHash) : false;
    if (!user || !passwordMatches) throw new AuthenticationError();

    const memberships = await this.store.listMemberships(user.id);
    // Accounts without an active organization are deliberately indistinguishable
    // from an invalid login to avoid exposing account provisioning details.
    if (memberships.length !== 1) throw new AuthenticationError();
    const membership = memberships[0]!;
    const issuedAt = this.now();
    const token = randomBytes(32).toString("base64url");
    const session: StoredSession = {
      id: token,
      userId: user.id,
      organizationId: membership.organizationId,
      expiresAt: new Date(issuedAt.getTime() + SESSION_TTL_MS),
      revokedAt: null,
    };
    await this.store.createSession(session);
    return { token, session };
  }

  async authenticate(token: string | undefined): Promise<AuthenticatedUser | null> {
    if (!token) return null;
    const session = await this.store.findSession(token);
    if (!session || session.revokedAt || session.expiresAt <= this.now()) return null;
    const membership = await this.store.findMembership(session.userId, session.organizationId);
    if (!membership) return null;
    const user = await this.store.findUserById(session.userId);
    return { userId: session.userId, organizationId: session.organizationId, role: membership.role, email: user?.email ?? "" };
  }

  async signOut(token: string | undefined): Promise<void> {
    if (token) await this.store.revokeSession(token, this.now());
  }

  async removeMember(actor: AuthenticatedUser, userId: string): Promise<void> {
    requireRole(actor, "owner");
    const memberships = await this.store.listMemberships(userId);
    const membership = memberships.find((candidate) => candidate.organizationId === actor.organizationId);
    if (!membership) throw new AuthorizationError();
    if (membership.role === "owner") {
      const owners = (await this.store.listMembershipsForOrganization(actor.organizationId))
        .filter((candidate) => candidate.role === "owner");
      if (owners.length <= 1) throw new AuthorizationError("An organization must retain at least one owner.");
    }
    await this.store.removeMembership(userId, actor.organizationId);
  }
}

const rank: Record<Role, number> = { viewer: 0, member: 1, owner: 2 };

export function requireRole(actor: AuthenticatedUser | null, minimum: Role): asserts actor is AuthenticatedUser {
  if (!actor || rank[actor.role] < rank[minimum]) throw new AuthorizationError();
}

export function requireOrganization(actor: AuthenticatedUser | null, organizationId: string): asserts actor is AuthenticatedUser {
  if (!actor || actor.organizationId !== organizationId) throw new AuthorizationError();
}

export async function hashPassword(password: string): Promise<string> {
  if (password.length < 12) throw new Error("Passwords must be at least 12 characters long.");
  return hash(password, 12);
}
