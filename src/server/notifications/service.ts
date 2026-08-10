import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { SessionIdentity } from "../auth/index.js";

export type NotificationFilter = "all" | "unread";

export class NotificationNotFoundError extends Error {}
export class NotificationValidationError extends Error {}

interface AuditRow {
  id: string;
  action: string;
  entityType: "task" | "deal";
  entityId: string;
  summaryJson: string;
  occurredAt: string;
}

interface Candidate {
  kind: "assignment" | "task_approaching" | "task_overdue" | "deal_change";
  entityType: "task" | "deal";
  entityId: string;
  dedupeKey: string;
  message: string;
  occurredAt: string;
}

export class NotificationService {
  constructor(
    private readonly db: Database.Database,
    private readonly now: () => Date = () => new Date(),
  ) {}

  list(identity: SessionIdentity, filter: NotificationFilter = "all") {
    this.generate(identity);
    const unread = filter === "unread" ? "AND n.read_at IS NULL" : "";
    const items = this.db
      .prepare(
        `SELECT n.id,n.kind,n.entity_type AS entityType,n.entity_id AS entityId,
          n.message,n.read_at AS readAt,n.created_at AS occurredAt
        FROM notifications n
        WHERE n.organization_id=? AND n.recipient_membership_id=? ${unread}
        ORDER BY n.created_at DESC,n.id DESC`,
      )
      .all(identity.organizationId, identity.membershipId)
      .map((row) => this.present(identity.organizationId, row));
    const unreadCount = (
      this.db
        .prepare(
          "SELECT count(*) AS count FROM notifications WHERE organization_id=? AND recipient_membership_id=? AND read_at IS NULL",
        )
        .get(identity.organizationId, identity.membershipId) as {
        count: number;
      }
    ).count;
    return { items, unreadCount };
  }

  generate(identity: SessionIdentity) {
    const candidates = [
      ...this.eventCandidates(identity),
      ...this.dueCandidates(identity),
    ];
    let created = 0;
    this.db
      .transaction(() => {
        const insert = this.db.prepare(
          `INSERT OR IGNORE INTO notifications
          (id,organization_id,recipient_membership_id,kind,entity_type,entity_id,dedupe_key,message,read_at,created_at)
          VALUES (?,?,?,?,?,?,?,?,NULL,?)`,
        );
        for (const item of candidates) {
          created += insert.run(
            `notification_${randomUUID()}`,
            identity.organizationId,
            identity.membershipId,
            item.kind,
            item.entityType,
            item.entityId,
            item.dedupeKey,
            item.message,
            item.occurredAt,
          ).changes;
        }
      })
      .immediate();
    return { created };
  }

  markRead(identity: SessionIdentity, id: string) {
    const result = this.db
      .prepare(
        `UPDATE notifications SET read_at=COALESCE(read_at,?)
        WHERE id=? AND organization_id=? AND recipient_membership_id=?`,
      )
      .run(
        this.now().toISOString(),
        id,
        identity.organizationId,
        identity.membershipId,
      );
    if (!result.changes)
      throw new NotificationNotFoundError("Notification not found.");
    return this.get(identity, id);
  }

  markAllRead(identity: SessionIdentity) {
    const result = this.db
      .prepare(
        `UPDATE notifications SET read_at=?
        WHERE organization_id=? AND recipient_membership_id=? AND read_at IS NULL`,
      )
      .run(
        this.now().toISOString(),
        identity.organizationId,
        identity.membershipId,
      );
    return { updated: result.changes };
  }

  private get(identity: SessionIdentity, id: string) {
    const row = this.db
      .prepare(
        `SELECT id,kind,entity_type AS entityType,entity_id AS entityId,message,
        read_at AS readAt,created_at AS occurredAt FROM notifications
        WHERE id=? AND organization_id=? AND recipient_membership_id=?`,
      )
      .get(id, identity.organizationId, identity.membershipId);
    if (!row) throw new NotificationNotFoundError("Notification not found.");
    return { notification: this.present(identity.organizationId, row) };
  }

  private eventCandidates(identity: SessionIdentity): Candidate[] {
    const rows = this.db
      .prepare(
        `SELECT id,action,entity_type AS entityType,entity_id AS entityId,
        summary_json AS summaryJson,occurred_at AS occurredAt
        FROM audit_events WHERE organization_id=?
        AND action IN ('task.created','task.updated','deal.transitioned')
        ORDER BY occurred_at,id`,
      )
      .all(identity.organizationId) as AuditRow[];
    const candidates: Candidate[] = [];
    for (const row of rows) {
      const summary = JSON.parse(row.summaryJson) as Record<string, unknown>;
      const recipient =
        row.action === "task.created"
          ? summary.assigneeMembershipId
          : row.action === "task.updated"
            ? summary.toAssigneeMembershipId
            : summary.recipientMembershipId;
      if (recipient !== identity.membershipId) continue;
      if (row.action === "task.updated" && !summary.assignmentChanged) continue;
      if (row.action === "deal.transitioned") {
        candidates.push({
          kind: "deal_change",
          entityType: "deal",
          entityId: row.entityId,
          dedupeKey: `deal-change:${row.id}`,
          message: `Deal moved to ${String(summary.toStageName ?? summary.status ?? "a new stage")}.`,
          occurredAt: row.occurredAt,
        });
      } else {
        candidates.push({
          kind: "assignment",
          entityType: "task",
          entityId: row.entityId,
          dedupeKey: `task-assignment:${row.id}`,
          message: "A task was assigned to you.",
          occurredAt: row.occurredAt,
        });
      }
    }
    return candidates;
  }

  private dueCandidates(identity: SessionIdentity): Candidate[] {
    const now = this.now();
    const approachingEnd = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const rows = this.db
      .prepare(
        `SELECT id,title,due_at AS dueAt FROM tasks
        WHERE organization_id=? AND assignee_membership_id=?
        AND archived_at IS NULL AND status IN ('open','in_progress')
        AND due_at<=? ORDER BY due_at,id`,
      )
      .all(
        identity.organizationId,
        identity.membershipId,
        approachingEnd.toISOString(),
      ) as Array<{ id: string; title: string; dueAt: string }>;
    return rows.map((task) => {
      const overdue = task.dueAt < now.toISOString();
      return {
        kind: overdue ? "task_overdue" : "task_approaching",
        entityType: "task",
        entityId: task.id,
        dedupeKey: `task-${overdue ? "overdue" : "approaching"}:${task.id}:${task.dueAt}`,
        message: overdue
          ? `${task.title} is overdue.`
          : `${task.title} is due within 24 hours.`,
        occurredAt: now.toISOString(),
      };
    });
  }

  private present(organizationId: string, value: unknown) {
    const row = value as {
      id: string;
      kind: Candidate["kind"];
      entityType: "task" | "deal";
      entityId: string;
      message: string;
      readAt: string | null;
      occurredAt: string;
    };
    const exists = this.db
      .prepare(
        `SELECT 1 FROM ${row.entityType}s WHERE organization_id=? AND id=?`,
      )
      .get(organizationId, row.entityId);
    const titles = {
      assignment: "Task assigned",
      task_approaching: "Task due soon",
      task_overdue: "Task overdue",
      deal_change: "Deal changed",
    };
    return {
      ...row,
      title: titles[row.kind],
      body: row.message,
      href: exists
        ? `#${row.entityType}s/${encodeURIComponent(row.entityId)}`
        : null,
    };
  }
}
