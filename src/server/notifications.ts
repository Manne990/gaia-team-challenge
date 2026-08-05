import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';

export type NotificationActor = {
  organizationId: string;
  membershipId: string;
  role: 'owner' | 'member' | 'viewer';
};
export class NotificationError extends Error {
  constructor(
    public code: 'NOT_FOUND' | 'FORBIDDEN',
    message: string,
  ) {
    super(message);
  }
}
export class NotificationService {
  constructor(
    private db: Database.Database,
    private now = () => new Date(),
  ) {}
  /** Idempotent scheduler: each policy window has one recipient-scoped dedupe key. */
  generate(organizationId: string) {
    const now = this.now(),
      iso = now.toISOString(),
      day = iso.slice(0, 10),
      soon = new Date(now.getTime() + 24 * 3600_000).toISOString();
    let created = 0;
    const insert = this.db.prepare(
      'INSERT OR IGNORE INTO notifications (id,organization_id,membership_id,dedupe_key,type,payload_json,created_at) VALUES (?,?,?,?,?,?,?)',
    );
    const add = (membershipId: string, key: string, type: string, payload: unknown) => {
      if (
        insert.run(
          randomUUID(),
          organizationId,
          membershipId,
          key,
          type,
          JSON.stringify(payload),
          iso,
        ).changes
      )
        created++;
    };
    for (const task of this.db
      .prepare(
        "SELECT id,title,assignee_membership_id,due_at FROM tasks WHERE organization_id=? AND archived_at IS NULL AND status NOT IN ('completed','cancelled') AND due_at IS NOT NULL",
      )
      .all(organizationId) as {
      id: string;
      title: string;
      assignee_membership_id: string;
      due_at: string;
    }[]) {
      const due = new Date(task.due_at);
      if (due <= now)
        add(task.assignee_membership_id, `task-overdue:${task.id}:${day}`, 'task.overdue', {
          taskId: task.id,
          title: task.title,
          dueAt: task.due_at,
        });
      else if (due <= new Date(soon))
        add(task.assignee_membership_id, `task-approaching:${task.id}:${day}`, 'task.approaching', {
          taskId: task.id,
          title: task.title,
          dueAt: task.due_at,
        });
    }
    for (const deal of this.db
      .prepare(
        'SELECT id,name,owner_membership_id,updated_at FROM deals WHERE organization_id=? AND archived_at IS NULL',
      )
      .all(organizationId) as {
      id: string;
      name: string;
      owner_membership_id: string;
      updated_at: string;
    }[])
      add(deal.owner_membership_id, `deal-changed:${deal.id}:${deal.updated_at}`, 'deal.changed', {
        dealId: deal.id,
        name: deal.name,
      });
    return { created };
  }
  list(actor: NotificationActor, unreadOnly = false) {
    const where = `organization_id=? AND membership_id=?${unreadOnly ? ' AND read_at IS NULL' : ''}`;
    const rows = this.db
      .prepare(`SELECT * FROM notifications WHERE ${where} ORDER BY created_at DESC,id DESC`)
      .all(actor.organizationId, actor.membershipId) as { payload_json: string }[];
    return rows.map((row) => ({ ...row, payload: JSON.parse(row.payload_json) }));
  }
  markRead(actor: NotificationActor, id: string) {
    const result = this.db
      .prepare(
        'UPDATE notifications SET read_at=? WHERE id=? AND organization_id=? AND membership_id=?',
      )
      .run(this.now().toISOString(), id, actor.organizationId, actor.membershipId);
    if (!result.changes) throw new NotificationError('NOT_FOUND', 'Notification not found.');
  }
  markAllRead(actor: NotificationActor) {
    return this.db
      .prepare(
        'UPDATE notifications SET read_at=? WHERE organization_id=? AND membership_id=? AND read_at IS NULL',
      )
      .run(this.now().toISOString(), actor.organizationId, actor.membershipId).changes;
  }
}
