import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  AuthService,
  AuthorizationError,
  type SessionIdentity,
} from "../auth/service.js";

const statuses = ["active", "inactive", "unqualified"] as const;
const preferences = ["email", "phone", "none"] as const;

export const contactInputSchema = z.object({
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  email: z.string().trim().email().max(254).nullable().optional(),
  phone: z.string().trim().max(50).nullable().optional(),
  jobTitle: z.string().trim().max(150).nullable().optional(),
  companyId: z.string().trim().min(1).nullable().optional(),
  ownerMembershipId: z.string().trim().min(1).nullable().optional(),
  status: z.enum(statuses),
  tags: z.array(z.string().trim().min(1).max(50)).max(20),
  communicationPreference: z.enum(preferences),
  version: z.number().int().positive().optional(),
});

export type ContactInput = z.infer<typeof contactInputSchema>;

export class ContactNotFoundError extends Error {}
export class ContactConflictError extends Error {}

interface ContactRow {
  id: string;
  organizationId: string;
  companyId: string | null;
  firstName: string;
  lastName: string;
  email: string | null;
  emailNormalized: string | null;
  phone: string | null;
  jobTitle: string | null;
  ownerMembershipId: string | null;
  status: (typeof statuses)[number];
  tagsJson: string;
  communicationPreference: (typeof preferences)[number];
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  version: number;
}

const selectContact = `
  SELECT c.id, c.organization_id AS organizationId, c.company_id AS companyId,
    c.first_name AS firstName, c.last_name AS lastName, c.email,
    c.email_normalized AS emailNormalized, c.phone, c.job_title AS jobTitle,
    c.owner_membership_id AS ownerMembershipId, c.status,
    c.tags_json AS tagsJson, c.communication_preference AS communicationPreference,
    c.created_at AS createdAt, c.updated_at AS updatedAt,
    c.archived_at AS archivedAt, c.version
  FROM contacts c`;

export class ContactsService {
  constructor(
    private readonly db: Database.Database,
    private readonly auth: AuthService,
    private readonly now: () => Date = () => new Date(),
  ) {}

  list(identity: SessionIdentity, query: Record<string, string | undefined>) {
    const page = clampInteger(query.page, 1, 10_000, 1);
    const pageSize = clampInteger(query.pageSize, 1, 100, 20);
    const allowedSorts: Record<string, string> = {
      name: "c.last_name",
      created: "c.created_at",
      updated: "c.updated_at",
      status: "c.status",
      company: "companyName",
    };
    const sort = allowedSorts[query.sort ?? "name"] ?? allowedSorts.name;
    const direction = query.order === "desc" ? "DESC" : "ASC";
    const clauses = [
      "c.organization_id = ?",
      "NOT EXISTS (SELECT 1 FROM merge_redirects mr WHERE mr.organization_id=c.organization_id AND mr.entity_type='contact' AND mr.source_id=c.id)",
    ];
    const values: unknown[] = [identity.organizationId];
    if (query.includeArchived !== "true") clauses.push("c.archived_at IS NULL");
    for (const [value, sql] of [
      [query.companyId, "c.company_id = ?"],
      [query.ownerId, "c.owner_membership_id = ?"],
      [query.status, "c.status = ?"],
    ] as const) {
      if (value) {
        clauses.push(sql);
        values.push(value);
      }
    }
    if (query.tag) {
      clauses.push(
        "EXISTS (SELECT 1 FROM json_each(c.tags_json) WHERE value = ?)",
      );
      values.push(query.tag.trim().toLocaleLowerCase());
    }
    if (query.q?.trim()) {
      clauses.push(
        "(c.first_name || ' ' || c.last_name LIKE ? OR c.email LIKE ? OR c.phone LIKE ?)",
      );
      const term = `%${query.q.trim()}%`;
      values.push(term, term, term);
    }
    const where = clauses.join(" AND ");
    const total = (
      this.db
        .prepare(`SELECT count(*) AS count FROM contacts c WHERE ${where}`)
        .get(...values) as { count: number }
    ).count;
    const rows = this.db
      .prepare(
        `
      SELECT c.id, c.first_name AS firstName, c.last_name AS lastName, c.email,
        c.phone, c.job_title AS jobTitle, c.status, c.tags_json AS tagsJson,
        c.communication_preference AS communicationPreference, c.version,
        c.archived_at AS archivedAt, c.company_id AS companyId,
        co.name AS companyName, u.display_name AS ownerName,
        CASE WHEN c.email_normalized IS NOT NULL AND
          (SELECT count(*) FROM contacts d WHERE d.organization_id = c.organization_id
           AND d.email_normalized = c.email_normalized AND d.archived_at IS NULL) > 1
          THEN 1 ELSE 0 END AS duplicateWarning
      FROM contacts c
      LEFT JOIN companies co ON co.id = c.company_id AND co.organization_id = c.organization_id
      LEFT JOIN memberships m ON m.id = c.owner_membership_id AND m.organization_id = c.organization_id
      LEFT JOIN users u ON u.id = m.user_id
      WHERE ${where}
      ORDER BY ${sort} ${direction}, c.id ${direction}
      LIMIT ? OFFSET ?
    `,
      )
      .all(...values, pageSize, (page - 1) * pageSize) as Array<
      Record<string, unknown> & { tagsJson: string; duplicateWarning: number }
    >;
    return {
      items: rows.map(({ tagsJson, duplicateWarning, ...row }) => ({
        ...row,
        tags: JSON.parse(tagsJson) as string[],
        duplicateWarning: duplicateWarning === 1,
      })),
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  get(identity: SessionIdentity, id: string) {
    const requestedId = id;
    const redirect = this.db
      .prepare(
        "SELECT target_id AS targetId FROM merge_redirects WHERE organization_id=? AND entity_type='contact' AND source_id=?",
      )
      .get(identity.organizationId, id) as { targetId: string } | undefined;
    if (redirect) id = redirect.targetId;
    const contact = this.find(identity, id);
    const parameters = [identity.organizationId, id];
    const company = contact.companyId
      ? this.db
          .prepare(
            "SELECT id, name, lifecycle_status AS lifecycleStatus FROM companies WHERE organization_id = ? AND id = ?",
          )
          .get(identity.organizationId, contact.companyId)
      : null;
    const activities = this.db
      .prepare(
        `SELECT a.id, a.type, a.subject, a.body, a.occurred_at AS occurredAt,
          COALESCE(a.creator_label, 'Former team member') AS creatorLabel,
          a.company_label AS companyLabel, a.contact_label AS contactLabel,
          a.follow_up_task_id AS followUpTaskId
        FROM activities a WHERE a.organization_id = ? AND
          (a.contact_id = ? OR EXISTS (SELECT 1 FROM activity_participants ap
            WHERE ap.organization_id = a.organization_id AND ap.activity_id = a.id AND ap.contact_id = ?))
        ORDER BY a.occurred_at DESC, a.created_at DESC, a.id DESC LIMIT 50`,
      )
      .all(...parameters, id);
    const deals = this.db
      .prepare(
        `SELECT d.id, d.name, d.amount_minor AS amountMinor, d.currency, d.status
      FROM deals d JOIN deal_contacts dc ON dc.deal_id = d.id AND dc.organization_id = d.organization_id
      WHERE dc.organization_id = ? AND dc.contact_id = ? ORDER BY d.updated_at DESC, d.id`,
      )
      .all(...parameters);
    const tasks = this.db
      .prepare(
        "SELECT id, title, due_at AS dueAt, priority, status FROM tasks WHERE organization_id = ? AND contact_id = ? ORDER BY due_at, id",
      )
      .all(...parameters);
    const history = this.db
      .prepare(
        "SELECT id, action, summary_json AS summaryJson, occurred_at AS occurredAt FROM audit_events WHERE organization_id = ? AND entity_type = 'contact' AND entity_id = ? ORDER BY occurred_at DESC, id LIMIT 50",
      )
      .all(...parameters) as Array<{
      id: string;
      action: string;
      summaryJson: string;
      occurredAt: string;
    }>;
    return {
      ...this.present(contact),
      redirect: redirect ? { from: requestedId, to: id } : undefined,
      company,
      activities,
      deals,
      tasks,
      history: history.map(({ summaryJson, ...event }) => ({
        ...event,
        summary: JSON.parse(summaryJson) as object,
      })),
      duplicateWarning:
        this.duplicateCount(
          identity.organizationId,
          contact.emailNormalized,
          id,
        ) > 0,
    };
  }

  create(identity: SessionIdentity, raw: unknown) {
    this.auth.requireRole(identity, "member");
    const input = contactInputSchema.parse(raw);
    this.validateRelations(identity, input);
    const id = `contact_${randomUUID()}`;
    const timestamp = this.now().toISOString();
    this.db
      .transaction(() => {
        this.db
          .prepare(
            `INSERT INTO contacts
        (id, organization_id, company_id, first_name, last_name, email, email_normalized,
         phone, job_title, owner_membership_id, status, tags_json, communication_preference,
         created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            id,
            identity.organizationId,
            input.companyId ?? null,
            input.firstName,
            input.lastName,
            cleanNullable(input.email),
            normalizeEmail(input.email),
            cleanNullable(input.phone),
            cleanNullable(input.jobTitle),
            input.ownerMembershipId ?? identity.membershipId,
            input.status,
            JSON.stringify(uniqueTags(input.tags)),
            input.communicationPreference,
            timestamp,
            timestamp,
          );
        this.audit(identity, "contact.created", id, {
          fields: Object.keys(input).filter((key) => key !== "version"),
        });
      })
      .immediate();
    return this.get(identity, id);
  }

  update(identity: SessionIdentity, id: string, raw: unknown) {
    this.auth.requireRole(identity, "member");
    this.assertNotMerged(identity, id);
    const input = contactInputSchema.parse(raw);
    if (!input.version)
      throw new ContactConflictError("A record version is required.");
    this.validateRelations(identity, input);
    const current = this.find(identity, id);
    if (current.version !== input.version)
      throw new ContactConflictError(
        "This contact changed since you opened it. Refresh and try again.",
      );
    const timestamp = this.now().toISOString();
    const result = this.db
      .transaction(() => {
        const update = this.db
          .prepare(
            `UPDATE contacts SET company_id = ?, first_name = ?, last_name = ?,
        email = ?, email_normalized = ?, phone = ?, job_title = ?, owner_membership_id = ?,
        status = ?, tags_json = ?, communication_preference = ?, updated_at = ?, version = version + 1
        WHERE organization_id = ? AND id = ? AND version = ?`,
          )
          .run(
            input.companyId ?? null,
            input.firstName,
            input.lastName,
            cleanNullable(input.email),
            normalizeEmail(input.email),
            cleanNullable(input.phone),
            cleanNullable(input.jobTitle),
            input.ownerMembershipId ?? identity.membershipId,
            input.status,
            JSON.stringify(uniqueTags(input.tags)),
            input.communicationPreference,
            timestamp,
            identity.organizationId,
            id,
            input.version,
          );
        if (update.changes !== 1)
          throw new ContactConflictError(
            "This contact changed since you opened it. Refresh and try again.",
          );
        this.audit(identity, "contact.updated", id, {
          previousVersion: current.version,
        });
        return this.get(identity, id);
      })
      .immediate();
    return result;
  }

  setArchived(identity: SessionIdentity, id: string, archived: boolean) {
    this.auth.requireRole(identity, "member");
    this.assertNotMerged(identity, id);
    this.find(identity, id);
    const timestamp = this.now().toISOString();
    this.db
      .transaction(() => {
        this.db
          .prepare(
            "UPDATE contacts SET archived_at = ?, updated_at = ?, version = version + 1 WHERE organization_id = ? AND id = ?",
          )
          .run(
            archived ? timestamp : null,
            timestamp,
            identity.organizationId,
            id,
          );
        this.audit(
          identity,
          archived ? "contact.archived" : "contact.restored",
          id,
          {},
        );
      })
      .immediate();
    return this.get(identity, id);
  }

  private find(identity: SessionIdentity, id: string): ContactRow {
    const row = this.db
      .prepare(`${selectContact} WHERE c.organization_id = ? AND c.id = ?`)
      .get(identity.organizationId, id) as ContactRow | undefined;
    if (!row)
      throw new ContactNotFoundError("The requested contact was not found.");
    return row;
  }

  private assertNotMerged(identity: SessionIdentity, id: string) {
    if (
      this.db
        .prepare(
          "SELECT 1 FROM merge_redirects WHERE organization_id=? AND entity_type='contact' AND source_id=?",
        )
        .get(identity.organizationId, id)
    )
      throw new ContactConflictError(
        "This contact was merged. Open its surviving record instead.",
      );
  }

  private present(row: ContactRow) {
    const { tagsJson, emailNormalized, ...contact } = row;
    void emailNormalized;
    return { ...contact, tags: JSON.parse(tagsJson) as string[] };
  }

  private validateRelations(identity: SessionIdentity, input: ContactInput) {
    if (
      input.companyId &&
      !this.db
        .prepare("SELECT 1 FROM companies WHERE organization_id = ? AND id = ?")
        .get(identity.organizationId, input.companyId)
    )
      throw new AuthorizationError("The requested company was not found.");
    if (
      input.ownerMembershipId &&
      !this.db
        .prepare(
          "SELECT 1 FROM memberships WHERE organization_id = ? AND id = ? AND removed_at IS NULL",
        )
        .get(identity.organizationId, input.ownerMembershipId)
    )
      throw new AuthorizationError("The requested owner was not found.");
  }

  private duplicateCount(
    organizationId: string,
    normalized: string | null,
    excludedId: string,
  ) {
    if (!normalized) return 0;
    return (
      this.db
        .prepare(
          "SELECT count(*) AS count FROM contacts WHERE organization_id = ? AND email_normalized = ? AND id != ? AND archived_at IS NULL",
        )
        .get(organizationId, normalized, excludedId) as { count: number }
    ).count;
  }

  private audit(
    identity: SessionIdentity,
    action: string,
    id: string,
    summary: object,
  ) {
    this.db
      .prepare(
        `INSERT INTO audit_events
      (id, organization_id, actor_membership_id, action, entity_type, entity_id, summary_json, occurred_at)
      VALUES (?, ?, ?, ?, 'contact', ?, ?, ?)`,
      )
      .run(
        `audit_${randomUUID()}`,
        identity.organizationId,
        identity.membershipId,
        action,
        id,
        JSON.stringify(summary),
        this.now().toISOString(),
      );
  }
}

const normalizeEmail = (value: string | null | undefined) =>
  cleanNullable(value)?.toLowerCase() ?? null;
const cleanNullable = (value: string | null | undefined) =>
  value?.trim() || null;
const uniqueTags = (tags: string[]) =>
  [...new Set(tags.map((tag) => tag.trim().toLowerCase()))].sort();
function clampInteger(
  value: string | undefined,
  minimum: number,
  maximum: number,
  fallback: number,
) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : fallback;
}
