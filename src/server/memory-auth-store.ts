import type { AuthStore, AuthUser, Membership, StoredSession } from './auth.js';

/** Test adapter only. Production must provide a transaction-backed SQLite adapter. */
export class MemoryAuthStore implements AuthStore {
  readonly users = new Map<string, AuthUser>();
  readonly memberships: Membership[] = [];
  readonly sessions = new Map<string, StoredSession>();

  async findUserByEmail(email: string): Promise<AuthUser | null> {
    return [...this.users.values()].find((user) => user.email === email) ?? null;
  }
  async findUserById(userId: string): Promise<{ email: string } | null> {
    const user = this.users.get(userId);
    return user ? { email: user.email } : null;
  }
  async findMembership(userId: string, organizationId?: string): Promise<Membership | null> {
    return (
      this.memberships.find(
        (item) =>
          item.userId === userId && (!organizationId || item.organizationId === organizationId),
      ) ?? null
    );
  }
  async createSession(session: StoredSession): Promise<void> {
    this.sessions.set(session.id, session);
  }
  async findSession(id: string): Promise<StoredSession | null> {
    return this.sessions.get(id) ?? null;
  }
  async revokeSession(id: string, revokedAt: Date): Promise<void> {
    const session = this.sessions.get(id);
    if (session) this.sessions.set(id, { ...session, revokedAt });
  }
  async listMemberships(userId: string): Promise<Membership[]> {
    return this.memberships.filter((item) => item.userId === userId);
  }
  async removeMembership(userId: string, organizationId: string): Promise<void> {
    const index = this.memberships.findIndex(
      (item) => item.userId === userId && item.organizationId === organizationId,
    );
    if (index >= 0) this.memberships.splice(index, 1);
  }
  async listMembershipsForOrganization(organizationId: string): Promise<Membership[]> {
    return this.memberships.filter((item) => item.organizationId === organizationId);
  }
}
