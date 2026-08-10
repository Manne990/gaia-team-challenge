import type Database from "better-sqlite3";
import { z } from "zod";
import { AuthService, type SessionIdentity } from "../auth/index.js";

const querySchema = z.object({
  action: z.string().trim().max(120).optional(),
  entityType: z.string().trim().max(80).optional(),
  entityId: z.string().trim().max(200).optional(),
  actorMembershipId: z.string().trim().max(200).optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export class AuditValidationError extends Error {}

export class AuditService {
  private readonly auth: AuthService;

  constructor(private readonly db: Database.Database) {
    this.auth = new AuthService(db);
  }

  list(identity: SessionIdentity, search: URLSearchParams) {
    this.auth.requireRole(identity, "owner");
    const parsed = querySchema.safeParse(Object.fromEntries(search));
    if (!parsed.success)
      throw new AuditValidationError(
        parsed.error.issues.map(({ message }) => message).join(" "),
      );
    const query = parsed.data;
    const clauses = ["a.organization_id=?"];
    const parameters: unknown[] = [identity.organizationId];
    for (const [value, column] of [
      [query.action, "a.action"],
      [query.entityType, "a.entity_type"],
      [query.entityId, "a.entity_id"],
      [query.actorMembershipId, "a.actor_membership_id"],
    ] as const) {
      if (value) {
        clauses.push(`${column}=?`);
        parameters.push(value);
      }
    }
    if (query.from) {
      clauses.push("a.occurred_at>=?");
      parameters.push(new Date(query.from).toISOString());
    }
    if (query.to) {
      clauses.push("a.occurred_at<=?");
      parameters.push(new Date(query.to).toISOString());
    }
    const where = clauses.join(" AND ");
    const total = (
      this.db
        .prepare(`SELECT count(*) AS count FROM audit_events a WHERE ${where}`)
        .get(...parameters) as { count: number }
    ).count;
    const items = this.db
      .prepare(
        `SELECT a.id,a.action,a.entity_type AS entityType,a.entity_id AS entityId,
        a.actor_membership_id AS actorMembershipId,u.display_name AS actorName,
        a.summary_json AS summaryJson,a.occurred_at AS occurredAt,
        a.correlation_id AS correlationId
        FROM audit_events a
        LEFT JOIN memberships m ON m.id=a.actor_membership_id AND m.organization_id=a.organization_id
        LEFT JOIN users u ON u.id=m.user_id
        WHERE ${where} ORDER BY a.occurred_at DESC,a.id DESC LIMIT ? OFFSET ?`,
      )
      .all(...parameters, query.pageSize, (query.page - 1) * query.pageSize)
      .map((value) => {
        const { summaryJson, ...event } = value as {
          summaryJson: string;
          [key: string]: unknown;
        };
        return { ...event, summary: JSON.parse(summaryJson) };
      });
    return {
      items,
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    };
  }
}
