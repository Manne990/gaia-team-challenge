import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { z } from "zod";
import {
  AuthService,
  AuthorizationError,
  type SessionIdentity,
} from "../auth/service.js";

const types = ["call", "email", "meeting", "note", "status_change"] as const;
const priorities = ["low", "medium", "high", "urgent"] as const;
const optionalId = z.string().trim().min(1).nullable().optional();
const followUpSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().max(5000).default(""),
    assigneeMembershipId: z.string().trim().min(1),
    dueAt: z.string().datetime({ offset: true }),
    priority: z.enum(priorities),
  })
  .nullable()
  .optional();
export const activityCreateSchema = z.object({
  type: z.enum(types),
  subject: z.string().trim().min(1).max(200),
  body: z.string().trim().max(10000).default(""),
  occurredAt: z.string().datetime({ offset: true }),
  companyId: optionalId,
  contactId: optionalId,
  dealId: optionalId,
  participantContactIds: z.array(z.string().trim().min(1)).max(100).default([]),
  followUp: followUpSchema,
});
export const activityUpdateSchema = activityCreateSchema
  .omit({ followUp: true })
  .extend({
    version: z.number().int().positive(),
  });
const querySchema = z.object({
  page: z.coerce.number().int().min(1).max(10000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  type: z.enum(types).optional(),
  authorId: z.string().optional(),
  companyId: z.string().optional(),
  contactId: z.string().optional(),
  dealId: z.string().optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
});

export class ActivityNotFoundError extends Error {}
export class ActivityConflictError extends Error {}

export class ActivitiesService {
  constructor(
    private db: Database.Database,
    private auth: AuthService,
    private now = () => new Date(),
  ) {}

  list(identity: SessionIdentity, raw: Record<string, string | undefined>) {
    const query = querySchema.parse(raw);
    const clauses = ["a.organization_id = ?"];
    const values: unknown[] = [identity.organizationId];
    for (const [value, sql] of [
      [query.type, "a.type = ?"],
      [query.authorId, "a.creator_membership_id = ?"],
      [query.companyId, "a.company_id = ?"],
      [
        query.contactId,
        "(a.contact_id = ? OR EXISTS (SELECT 1 FROM activity_participants ap WHERE ap.organization_id = a.organization_id AND ap.activity_id = a.id AND ap.contact_id = ?))",
      ],
      [query.dealId, "a.deal_id = ?"],
      [query.from, "a.occurred_at >= ?"],
      [query.to, "a.occurred_at <= ?"],
    ] as const) {
      if (!value) continue;
      clauses.push(sql);
      values.push(value);
      if (sql.includes("ap.contact_id")) values.push(value);
    }
    const where = clauses.join(" AND ");
    const total = (
      this.db
        .prepare(`SELECT count(*) count FROM activities a WHERE ${where}`)
        .get(...values) as { count: number }
    ).count;
    const rows = this.db
      .prepare(
        `${selectActivity} WHERE ${where} ORDER BY a.occurred_at DESC, a.created_at DESC, a.id DESC LIMIT ? OFFSET ?`,
      )
      .all(
        ...values,
        query.pageSize,
        (query.page - 1) * query.pageSize,
      ) as ActivityRow[];
    return {
      items: rows.map((row) => this.present(row)),
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    };
  }

  get(identity: SessionIdentity, id: string) {
    const row = this.find(identity, id);
    return this.present(row);
  }

  create(identity: SessionIdentity, raw: unknown) {
    this.auth.requireRole(identity, "member");
    const input = activityCreateSchema.parse(raw);
    const id = `activity_${randomUUID()}`;
    const timestamp = this.now().toISOString();
    this.db
      .transaction(() => {
        const labels = this.validateRelations(identity, input);
        let taskId: string | null = null;
        if (input.followUp) {
          taskId = `task_${randomUUID()}`;
          this.db
            .prepare(
              `INSERT INTO tasks (id, organization_id, assignee_membership_id, company_id, contact_id, deal_id, title, description, due_at, priority, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`,
            )
            .run(
              taskId,
              identity.organizationId,
              input.followUp.assigneeMembershipId,
              input.companyId ?? null,
              input.contactId ?? null,
              input.dealId ?? null,
              input.followUp.title,
              input.followUp.description,
              input.followUp.dueAt,
              input.followUp.priority,
              timestamp,
              timestamp,
            );
        }
        this.db
          .prepare(
            `INSERT INTO activities (id, organization_id, creator_membership_id, company_id, contact_id, deal_id, type, subject, body, occurred_at, follow_up_task_id, created_at, updated_at, creator_label, company_label, contact_label, deal_label) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            id,
            identity.organizationId,
            identity.membershipId,
            input.companyId ?? null,
            input.contactId ?? null,
            input.dealId ?? null,
            input.type,
            input.subject,
            input.body,
            input.occurredAt,
            taskId,
            timestamp,
            timestamp,
            identity.displayName,
            labels.company,
            labels.contact,
            labels.deal,
          );
        const insertParticipant = this.db.prepare(
          "INSERT INTO activity_participants (organization_id, activity_id, contact_id, contact_label) VALUES (?, ?, ?, ?)",
        );
        for (const contactId of new Set(input.participantContactIds))
          insertParticipant.run(
            identity.organizationId,
            id,
            contactId,
            this.relationLabel(
              identity,
              "contacts",
              contactId,
              "trim(first_name||' '||last_name)",
            ),
          );
        this.audit(identity, "activity.created", id, {
          followUpTaskId: taskId,
        });
      })
      .immediate();
    return this.get(identity, id);
  }

  update(identity: SessionIdentity, id: string, raw: unknown) {
    this.auth.requireRole(identity, "member");
    const input = activityUpdateSchema.parse(raw);
    const current = this.find(identity, id);
    if (
      identity.role !== "owner" &&
      current.creatorMembershipId !== identity.membershipId
    )
      throw new AuthorizationError(
        "Only the creator or an owner can edit this activity.",
      );
    if (
      identity.role !== "owner" &&
      this.now().getTime() - Date.parse(current.createdAt) > 24 * 60 * 60 * 1000
    )
      throw new AuthorizationError(
        "Activities can only be edited by their creator for 24 hours.",
      );
    if (current.version !== input.version)
      throw new ActivityConflictError(
        "This activity changed since you opened it. Refresh and try again.",
      );
    const timestamp = this.now().toISOString();
    this.db
      .transaction(() => {
        const labels = this.validateRelations(identity, input);
        const companyLabel =
          (input.companyId ?? null) === current.companyId
            ? current.companyLabel
            : labels.company;
        const contactLabel =
          (input.contactId ?? null) === current.contactId
            ? current.contactLabel
            : labels.contact;
        const dealLabel =
          (input.dealId ?? null) === current.dealId
            ? current.dealLabel
            : labels.deal;
        const participantLabels = new Map(
          (
            this.db
              .prepare(
                "SELECT contact_id AS contactId, contact_label AS contactLabel FROM activity_participants WHERE organization_id=? AND activity_id=?",
              )
              .all(identity.organizationId, id) as Array<{
              contactId: string;
              contactLabel: string | null;
            }>
          ).map(({ contactId, contactLabel }) => [contactId, contactLabel]),
        );
        const result = this.db
          .prepare(
            `UPDATE activities SET company_id=?, contact_id=?, deal_id=?, type=?, subject=?, body=?, occurred_at=?, company_label=?, contact_label=?, deal_label=?, updated_at=?, version=version+1 WHERE organization_id=? AND id=? AND version=?`,
          )
          .run(
            input.companyId ?? null,
            input.contactId ?? null,
            input.dealId ?? null,
            input.type,
            input.subject,
            input.body,
            input.occurredAt,
            companyLabel,
            contactLabel,
            dealLabel,
            timestamp,
            identity.organizationId,
            id,
            input.version,
          );
        if (!result.changes)
          throw new ActivityConflictError(
            "This activity changed since you opened it. Refresh and try again.",
          );
        this.db
          .prepare(
            "DELETE FROM activity_participants WHERE organization_id=? AND activity_id=?",
          )
          .run(identity.organizationId, id);
        const insert = this.db.prepare(
          "INSERT INTO activity_participants (organization_id, activity_id, contact_id, contact_label) VALUES (?, ?, ?, ?)",
        );
        for (const contactId of new Set(input.participantContactIds))
          insert.run(
            identity.organizationId,
            id,
            contactId,
            participantLabels.get(contactId) ??
              this.relationLabel(
                identity,
                "contacts",
                contactId,
                "trim(first_name||' '||last_name)",
              ),
          );
        this.audit(identity, "activity.updated", id, {
          version: input.version + 1,
        });
      })
      .immediate();
    return this.get(identity, id);
  }

  private find(identity: SessionIdentity, id: string) {
    const row = this.db
      .prepare(`${selectActivity} WHERE a.organization_id=? AND a.id=?`)
      .get(identity.organizationId, id) as ActivityRow | undefined;
    if (!row) throw new ActivityNotFoundError();
    return row;
  }
  private present(row: ActivityRow) {
    const participants = this.db
      .prepare(
        `SELECT ap.contact_id id, COALESCE(ap.contact_label, trim(c.first_name||' '||c.last_name), 'Archived contact') label FROM activity_participants ap LEFT JOIN contacts c ON c.id=ap.contact_id AND c.organization_id=ap.organization_id WHERE ap.organization_id=? AND ap.activity_id=? ORDER BY label,id`,
      )
      .all(row.organizationId, row.id);
    return { ...row, participants };
  }
  private validateRelations(
    identity: SessionIdentity,
    input:
      | z.infer<typeof activityCreateSchema>
      | z.infer<typeof activityUpdateSchema>,
  ) {
    const label = (
      table: string,
      id: string | undefined | null,
      expr: string,
    ) => (id ? this.relationLabel(identity, table, id, expr) : null);
    const company = label("companies", input.companyId, "name"),
      contact = label(
        "contacts",
        input.contactId,
        "trim(first_name||' '||last_name)",
      ),
      deal = label("deals", input.dealId, "name");
    for (const id of new Set(input.participantContactIds))
      label("contacts", id, "id");
    if ("followUp" in input && input.followUp)
      label("memberships", input.followUp.assigneeMembershipId, "id");
    return { company, contact, deal };
  }
  private relationLabel(
    identity: SessionIdentity,
    table: string,
    id: string,
    expr: string,
  ) {
    const row = this.db
      .prepare(
        `SELECT ${expr} label FROM ${table} WHERE organization_id=? AND id=?`,
      )
      .get(identity.organizationId, id) as { label: string } | undefined;
    if (!row)
      throw new ActivityNotFoundError("A related record was not found.");
    return row.label;
  }
  private audit(
    identity: SessionIdentity,
    action: string,
    id: string,
    summary: object,
  ) {
    this.db
      .prepare(
        "INSERT INTO audit_events (id,organization_id,actor_membership_id,action,entity_type,entity_id,summary_json,occurred_at) VALUES (?,?,?,?,?,?,?,?)",
      )
      .run(
        `audit_${randomUUID()}`,
        identity.organizationId,
        identity.membershipId,
        action,
        "activity",
        id,
        JSON.stringify(summary),
        this.now().toISOString(),
      );
  }
}

interface ActivityRow {
  id: string;
  organizationId: string;
  creatorMembershipId: string;
  creatorLabel: string;
  companyId: string | null;
  companyLabel: string | null;
  contactId: string | null;
  contactLabel: string | null;
  dealId: string | null;
  dealLabel: string | null;
  type: string;
  subject: string;
  body: string;
  occurredAt: string;
  followUpTaskId: string | null;
  followUpTitle: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}
const selectActivity = `SELECT a.id,a.organization_id organizationId,a.creator_membership_id creatorMembershipId,COALESCE(a.creator_label,'Former team member') creatorLabel,a.company_id companyId,a.company_label companyLabel,a.contact_id contactId,a.contact_label contactLabel,a.deal_id dealId,a.deal_label dealLabel,a.type,a.subject,a.body,a.occurred_at occurredAt,a.follow_up_task_id followUpTaskId,t.title followUpTitle,a.created_at createdAt,a.updated_at updatedAt,a.version FROM activities a LEFT JOIN tasks t ON t.id=a.follow_up_task_id AND t.organization_id=a.organization_id`;
