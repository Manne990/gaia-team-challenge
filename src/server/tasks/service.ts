import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { SessionIdentity } from "../auth/index.js";

const priority = z.enum(["low", "medium", "high", "urgent"]);
const status = z.enum(["open", "in_progress", "completed", "cancelled"]);
const editableStatus = z.enum(["open", "in_progress", "cancelled"]);
const optionalId = z
  .string()
  .trim()
  .min(1)
  .optional()
  .nullable()
  .transform((value) => value || null);

export const taskInput = z.object({
  title: z.string().trim().min(1).max(240),
  description: z.string().trim().max(5000).default(""),
  assigneeMembershipId: z.string().trim().min(1),
  dueAt: z.iso
    .datetime({ offset: true })
    .transform((value) => new Date(value).toISOString()),
  priority,
  status: editableStatus.optional(),
  companyId: optionalId,
  contactId: optionalId,
  dealId: optionalId,
  version: z.number().int().positive().optional(),
});

export class TaskNotFoundError extends Error {}
export class TaskConflictError extends Error {}
export class TaskVersionConflictError extends Error {}
export class TaskValidationError extends Error {
  constructor(readonly issues: string[]) {
    super("Correct the highlighted task fields.");
  }
}

export interface TaskRecord {
  id: string;
  title: string;
  description: string;
  assigneeMembershipId: string;
  assigneeName: string;
  dueAt: string;
  priority: z.infer<typeof priority>;
  status: z.infer<typeof status>;
  companyId: string | null;
  companyName: string | null;
  contactId: string | null;
  contactName: string | null;
  dealId: string | null;
  dealName: string | null;
  completedAt: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

const selectTask = `
  SELECT t.id, t.title, t.description,
    t.assignee_membership_id AS assigneeMembershipId,
    u.display_name AS assigneeName, t.due_at AS dueAt, t.priority, t.status,
    t.company_id AS companyId, c.name AS companyName,
    t.contact_id AS contactId,
    CASE WHEN ct.id IS NULL THEN NULL ELSE ct.first_name || ' ' || ct.last_name END AS contactName,
    t.deal_id AS dealId, d.name AS dealName,
    t.completed_at AS completedAt, t.archived_at AS archivedAt,
    t.created_at AS createdAt, t.updated_at AS updatedAt, t.version
  FROM tasks t
  JOIN memberships m ON m.id = t.assignee_membership_id AND m.organization_id = t.organization_id
  JOIN users u ON u.id = m.user_id
  LEFT JOIN companies c ON c.id = t.company_id AND c.organization_id = t.organization_id
  LEFT JOIN contacts ct ON ct.id = t.contact_id AND ct.organization_id = t.organization_id
  LEFT JOIN deals d ON d.id = t.deal_id AND d.organization_id = t.organization_id`;

function parseInput(value: unknown) {
  const parsed = taskInput.safeParse(value);
  if (!parsed.success)
    throw new TaskValidationError(
      parsed.error.issues.map((issue) => issue.message),
    );
  return parsed.data;
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export class TaskService {
  constructor(
    private readonly db: Database.Database,
    private readonly now: () => Date = () => new Date(),
  ) {}

  list(identity: SessionIdentity, query: URLSearchParams) {
    const page = Math.max(1, Number(query.get("page")) || 1);
    const pageSize = Math.min(
      100,
      Math.max(1, Number(query.get("pageSize")) || 25),
    );
    const clauses = ["t.organization_id = ?"];
    const params: unknown[] = [identity.organizationId];
    if (query.get("archived") === "only")
      clauses.push("t.archived_at IS NOT NULL");
    else if (query.get("archived") !== "include")
      clauses.push("t.archived_at IS NULL");
    const view = query.get("view");
    const now = this.now();
    const today = isoDay(now);
    if (view === "assigned_to_me") {
      clauses.push(
        "t.assignee_membership_id = ?",
        "t.status NOT IN ('completed', 'cancelled')",
      );
      params.push(identity.membershipId);
    } else if (view === "overdue") {
      clauses.push(
        "t.due_at < ?",
        "t.status NOT IN ('completed', 'cancelled')",
      );
      params.push(now.toISOString());
    } else if (view === "today") {
      clauses.push(
        "substr(t.due_at, 1, 10) = ?",
        "t.status NOT IN ('completed', 'cancelled')",
      );
      params.push(today);
    } else if (view === "upcoming") {
      clauses.push(
        "t.due_at > ?",
        "t.status NOT IN ('completed', 'cancelled')",
      );
      params.push(`${today}T23:59:59.999Z`);
    } else if (view === "completed") clauses.push("t.status = 'completed'");
    for (const [parameter, column] of [
      ["assignee", "t.assignee_membership_id"],
      ["priority", "t.priority"],
      ["status", "t.status"],
      ["company", "t.company_id"],
      ["contact", "t.contact_id"],
      ["deal", "t.deal_id"],
    ] as const) {
      const value = query.get(parameter);
      if (value) {
        clauses.push(`${column} = ?`);
        params.push(value);
      }
    }
    const text = query.get("q")?.trim();
    if (text) {
      const escaped = `%${text.replace(/[\\%_]/g, "\\$&")}%`;
      clauses.push(
        "(t.title LIKE ? ESCAPE '\\' OR t.description LIKE ? ESCAPE '\\')",
      );
      params.push(escaped, escaped);
    }
    const where = clauses.join(" AND ");
    const total = (
      this.db
        .prepare(`SELECT COUNT(*) AS count FROM tasks t WHERE ${where}`)
        .get(...params) as { count: number }
    ).count;
    const items = this.db
      .prepare(
        `${selectTask} WHERE ${where} ORDER BY t.due_at ASC, t.id ASC LIMIT ? OFFSET ?`,
      )
      .all(...params, pageSize, (page - 1) * pageSize) as TaskRecord[];
    const assignees = this.db
      .prepare(
        `SELECT m.id, u.display_name AS name FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.organization_id = ? AND m.removed_at IS NULL ORDER BY u.display_name, m.id`,
      )
      .all(identity.organizationId);
    return {
      items,
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
      assignees,
      timezone: "UTC" as const,
    };
  }

  get(identity: SessionIdentity, id: string) {
    const task = this.db
      .prepare(`${selectTask} WHERE t.organization_id = ? AND t.id = ?`)
      .get(identity.organizationId, id) as TaskRecord | undefined;
    if (!task) throw new TaskNotFoundError("Task not found.");
    const history = this.db
      .prepare(
        `SELECT id, action, summary_json AS summaryJson, occurred_at AS occurredAt FROM audit_events WHERE organization_id = ? AND entity_type = 'task' AND entity_id = ? ORDER BY occurred_at DESC, id`,
      )
      .all(identity.organizationId, id)
      .map((entry) => {
        const row = entry as { summaryJson: string; [key: string]: unknown };
        const { summaryJson, ...fields } = row;
        return { ...fields, summary: JSON.parse(summaryJson) };
      });
    return { task, history };
  }

  create(identity: SessionIdentity, value: unknown) {
    const input = parseInput(value);
    const id = `task_${randomUUID()}`;
    const timestamp = this.now().toISOString();
    this.db
      .transaction(() => {
        this.assertRelations(identity.organizationId, input);
        this.db
          .prepare(
            `INSERT INTO tasks (id, organization_id, assignee_membership_id, company_id, contact_id, deal_id, title, description, due_at, priority, status, completed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', NULL, ?, ?)`,
          )
          .run(
            id,
            identity.organizationId,
            input.assigneeMembershipId,
            input.companyId,
            input.contactId,
            input.dealId,
            input.title,
            input.description,
            input.dueAt,
            input.priority,
            timestamp,
            timestamp,
          );
        this.audit(identity, "task.created", id, {
          title: input.title,
          assigneeMembershipId: input.assigneeMembershipId,
        });
      })
      .immediate();
    return this.get(identity, id);
  }

  update(identity: SessionIdentity, id: string, value: unknown) {
    const input = parseInput(value);
    if (input.version === undefined)
      throw new TaskValidationError([
        "Task version is required. Refresh and try again.",
      ]);
    return this.change(identity, id, input.version, (current, timestamp) => {
      this.assertRelations(identity.organizationId, input);
      if (current.status === "completed")
        throw new TaskConflictError("Reopen this task before editing it.");
      this.db
        .prepare(
          `UPDATE tasks SET title = ?, description = ?, assignee_membership_id = ?, due_at = ?, priority = ?, status = ?, company_id = ?, contact_id = ?, deal_id = ?, updated_at = ?, version = version + 1 WHERE organization_id = ? AND id = ?`,
        )
        .run(
          input.title,
          input.description,
          input.assigneeMembershipId,
          input.dueAt,
          input.priority,
          input.status ?? current.status,
          input.companyId,
          input.contactId,
          input.dealId,
          timestamp,
          identity.organizationId,
          id,
        );
      this.audit(identity, "task.updated", id, {
        fromVersion: current.version,
        toVersion: current.version + 1,
        assignmentChanged:
          current.assigneeMembershipId !== input.assigneeMembershipId,
        fromAssigneeMembershipId: current.assigneeMembershipId,
        toAssigneeMembershipId: input.assigneeMembershipId,
      });
    });
  }

  setCompleted(
    identity: SessionIdentity,
    id: string,
    completed: boolean,
    version: number,
  ) {
    return this.change(identity, id, version, (current, timestamp) => {
      if (completed && current.status === "completed")
        throw new TaskConflictError("Task is already completed.");
      if (!completed && current.status !== "completed")
        throw new TaskConflictError("Task is not completed.");
      this.db
        .prepare(
          `UPDATE tasks SET status = ?, completed_at = ?, updated_at = ?, version = version + 1 WHERE organization_id = ? AND id = ?`,
        )
        .run(
          completed ? "completed" : "open",
          completed ? timestamp : null,
          timestamp,
          identity.organizationId,
          id,
        );
      this.audit(identity, completed ? "task.completed" : "task.reopened", id, {
        fromVersion: current.version,
        toVersion: current.version + 1,
      });
    });
  }

  setArchived(
    identity: SessionIdentity,
    id: string,
    archived: boolean,
    version: number,
  ) {
    return this.change(identity, id, version, (current, timestamp) => {
      if (Boolean(current.archivedAt) === archived)
        throw new TaskConflictError(
          archived ? "Task is already archived." : "Task is not archived.",
        );
      this.db
        .prepare(
          `UPDATE tasks SET archived_at = ?, updated_at = ?, version = version + 1 WHERE organization_id = ? AND id = ?`,
        )
        .run(
          archived ? timestamp : null,
          timestamp,
          identity.organizationId,
          id,
        );
      this.audit(identity, archived ? "task.archived" : "task.restored", id, {
        fromVersion: current.version,
        toVersion: current.version + 1,
      });
    });
  }

  private change(
    identity: SessionIdentity,
    id: string,
    version: number,
    mutate: (
      current: {
        version: number;
        status: string;
        archivedAt: string | null;
        assigneeMembershipId: string;
      },
      timestamp: string,
    ) => void,
  ) {
    this.db
      .transaction(() => {
        const current = this.db
          .prepare(
            "SELECT version, status, archived_at AS archivedAt, assignee_membership_id AS assigneeMembershipId FROM tasks WHERE organization_id = ? AND id = ?",
          )
          .get(identity.organizationId, id) as
          | {
              version: number;
              status: string;
              archivedAt: string | null;
              assigneeMembershipId: string;
            }
          | undefined;
        if (!current) throw new TaskNotFoundError("Task not found.");
        if (current.version !== version)
          throw new TaskVersionConflictError(
            "This task changed since you opened it. Refresh and try again.",
          );
        mutate(current, this.now().toISOString());
      })
      .immediate();
    return this.get(identity, id);
  }

  private assertRelations(
    organizationId: string,
    input: z.infer<typeof taskInput>,
  ) {
    const assignee = this.db
      .prepare(
        "SELECT 1 FROM memberships WHERE organization_id = ? AND id = ? AND removed_at IS NULL",
      )
      .get(organizationId, input.assigneeMembershipId);
    if (!assignee)
      throw new TaskValidationError([
        "Choose an active assignee from this organization.",
      ]);
    for (const [label, table, id] of [
      ["company", "companies", input.companyId],
      ["contact", "contacts", input.contactId],
      ["deal", "deals", input.dealId],
    ] as const) {
      if (
        id &&
        !this.db
          .prepare(
            `SELECT 1 FROM ${table} WHERE organization_id = ? AND id = ?`,
          )
          .get(organizationId, id)
      )
        throw new TaskNotFoundError(`Related ${label} not found.`);
    }
  }

  private audit(
    identity: SessionIdentity,
    action: string,
    entityId: string,
    summary: Record<string, unknown>,
  ) {
    this.db
      .prepare(
        "INSERT INTO audit_events (id, organization_id, actor_membership_id, action, entity_type, entity_id, summary_json, occurred_at) VALUES (?, ?, ?, ?, 'task', ?, ?, ?)",
      )
      .run(
        `audit_${randomUUID()}`,
        identity.organizationId,
        identity.membershipId,
        action,
        entityId,
        JSON.stringify(summary),
        this.now().toISOString(),
      );
  }
}
