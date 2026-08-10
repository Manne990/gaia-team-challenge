// @vitest-environment node
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { migrate, openDatabase, type CrmDatabase } from "../../db/database.js";
import { seedDatabase } from "../../db/seed.js";
import { createApp } from "../app.js";
import type { SessionIdentity } from "../auth/index.js";
import { DealsService } from "../deals/service.js";
import { TaskService } from "../tasks/service.js";
import { NotificationNotFoundError, NotificationService } from "./service.js";

const directories: string[] = [];
const member: SessionIdentity = {
  sessionHash: "member-session",
  userId: "user_member",
  membershipId: "membership_member",
  organizationId: "org_northstar",
  role: "member",
  email: "member@northstar.test",
  displayName: "Northstar Member",
  expiresAt: "2030-01-01T00:00:00.000Z",
};
const owner = {
  ...member,
  membershipId: "membership_owner",
  userId: "user_owner",
};
const outside = {
  ...member,
  membershipId: "membership_outside",
  userId: "user_outside",
  organizationId: "org_outside",
};

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function database(path = ":memory:") {
  const db = openDatabase(path);
  migrate(db);
  seedDatabase(db);
  db.prepare("DELETE FROM notifications").run();
  db.prepare("DELETE FROM audit_events").run();
  db.prepare("UPDATE tasks SET due_at='2030-01-01T00:00:00.000Z'").run();
  return db;
}

function insertAudit(
  db: CrmDatabase,
  id: string,
  action: string,
  entityType: string,
  entityId: string,
  summary: object,
  occurredAt = "2026-02-10T10:00:00.000Z",
) {
  db.prepare(
    `INSERT INTO audit_events
    (id,organization_id,actor_membership_id,action,entity_type,entity_id,summary_json,occurred_at)
    VALUES (?,'org_northstar','membership_owner',?,?,?,?,?)`,
  ).run(id, action, entityType, entityId, JSON.stringify(summary), occurredAt);
}

describe.sequential("notification generation and personal state", () => {
  it("integrates task reassignment and deal transition audit writers", () => {
    const db = database();
    const at = () => new Date("2026-02-10T12:00:00.000Z");
    const tasks = new TaskService(db, at);
    const created = tasks.create(owner, {
      title: "Transfer renewal follow-up",
      description: "",
      assigneeMembershipId: "membership_owner",
      dueAt: "2027-01-01T12:00:00.000Z",
      priority: "high",
      companyId: null,
      contactId: null,
      dealId: null,
    });
    tasks.update(owner, created.task.id, {
      title: created.task.title,
      description: created.task.description,
      assigneeMembershipId: "membership_member",
      dueAt: created.task.dueAt,
      priority: created.task.priority,
      status: created.task.status,
      companyId: null,
      contactId: null,
      dealId: null,
      version: created.task.version,
    });

    const deal = db
      .prepare(
        `SELECT d.id,d.version,d.stage_id AS stageId FROM deals d
        WHERE d.organization_id='org_northstar' AND d.owner_membership_id='membership_member'
        AND d.status='open' LIMIT 1`,
      )
      .get() as { id: string; version: number; stageId: string };
    const stage = db
      .prepare(
        `SELECT id FROM pipeline_stages WHERE organization_id='org_northstar'
        AND kind='open' AND active=1 AND id<>? ORDER BY position LIMIT 1`,
      )
      .get(deal.stageId) as { id: string };
    new DealsService(db, at).transition(member, deal.id, {
      stageId: stage.id,
      version: deal.version,
    });

    const items = new NotificationService(db, at).list(member).items;
    expect(items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "assignment",
          entityId: created.task.id,
        }),
        expect.objectContaining({ kind: "deal_change", entityId: deal.id }),
      ]),
    );
    db.close();
  });

  it("generates assignment and deal events once for their recorded recipients", () => {
    const db = database();
    insertAudit(
      db,
      "audit_assignment",
      "task.created",
      "task",
      "task_northstar_01",
      {
        assigneeMembershipId: "membership_member",
      },
    );
    insertAudit(
      db,
      "audit_reassignment",
      "task.updated",
      "task",
      "task_northstar_02",
      {
        assignmentChanged: true,
        fromAssigneeMembershipId: "membership_owner",
        toAssigneeMembershipId: "membership_member",
      },
    );
    insertAudit(
      db,
      "audit_no_reassignment",
      "task.updated",
      "task",
      "task_northstar_03",
      {
        assignmentChanged: false,
        fromAssigneeMembershipId: "membership_member",
        toAssigneeMembershipId: "membership_member",
      },
    );
    insertAudit(
      db,
      "audit_deal",
      "deal.transitioned",
      "deal",
      "deal_northstar_01",
      {
        recipientMembershipId: "membership_member",
        toStageName: "Won",
        status: "won",
      },
    );
    const service = new NotificationService(
      db,
      () => new Date("2026-02-10T12:00:00.000Z"),
    );

    expect(service.generate(member).created).toBe(3);
    expect(service.generate(member).created).toBe(0);
    const result = service.list(member);
    expect(result.items.map((item) => item.kind).sort()).toEqual([
      "assignment",
      "assignment",
      "deal_change",
    ]);
    expect(JSON.stringify(service.list(owner))).not.toContain(
      "audit_assignment",
    );
    expect(service.list(outside)).toEqual({ items: [], unreadCount: 0 });
    db.close();
  });

  it("uses exact 24-hour and overdue boundaries and excludes completed or archived tasks", () => {
    const db = database();
    db.prepare(
      `UPDATE tasks SET assignee_membership_id='membership_member',status='open',completed_at=NULL,
      archived_at=NULL,due_at=? WHERE id=?`,
    ).run("2026-02-10T12:00:00.000Z", "task_northstar_01");
    db.prepare(
      "UPDATE tasks SET assignee_membership_id='membership_member',due_at=? WHERE id=?",
    ).run("2026-02-11T12:00:00.000Z", "task_northstar_02");
    db.prepare(
      "UPDATE tasks SET assignee_membership_id='membership_member',due_at=? WHERE id=?",
    ).run("2026-02-10T11:59:59.999Z", "task_northstar_03");
    db.prepare(
      "UPDATE tasks SET assignee_membership_id='membership_member',archived_at=?,due_at=? WHERE id=?",
    ).run(
      "2026-02-10T10:00:00.000Z",
      "2026-02-10T11:00:00.000Z",
      "task_northstar_04",
    );
    const service = new NotificationService(
      db,
      () => new Date("2026-02-10T12:00:00.000Z"),
    );

    const result = service.list(member);
    const kinds = new Map(
      result.items.map((item) => [item.entityId, item.kind]),
    );
    expect(kinds.get("task_northstar_01")).toBe("task_approaching");
    expect(kinds.get("task_northstar_02")).toBe("task_approaching");
    expect(kinds.get("task_northstar_03")).toBe("task_overdue");
    expect(kinds.has("task_northstar_04")).toBe(false);
    db.close();
  });

  it("keeps read state private and durable across restart", () => {
    const directory = mkdtempSync(join(tmpdir(), "northstar-notifications-"));
    directories.push(directory);
    const path = join(directory, "crm.sqlite");
    let db = database(path);
    insertAudit(
      db,
      "audit_private",
      "task.created",
      "task",
      "task_northstar_01",
      {
        assigneeMembershipId: "membership_member",
      },
    );
    let service = new NotificationService(
      db,
      () => new Date("2026-02-10T12:00:00.000Z"),
    );
    const notification = service.list(member).items[0]!;
    db.prepare(
      `INSERT INTO notifications
      (id,organization_id,recipient_membership_id,kind,entity_type,entity_id,dedupe_key,message,created_at)
      VALUES ('notification_deleted','org_northstar','membership_member','assignment','task','task_deleted','deleted-relation','Historical assignment.','2026-02-10T11:00:00.000Z')`,
    ).run();
    expect(
      service.list(member).items.find(({ id }) => id === "notification_deleted")
        ?.href,
    ).toBeNull();
    expect(() => service.markRead(owner, notification.id)).toThrow(
      NotificationNotFoundError,
    );
    expect(service.markAllRead(owner).updated).toBe(0);
    expect(service.list(member).unreadCount).toBe(2);
    expect(service.markRead(member, notification.id).notification.readAt).toBe(
      "2026-02-10T12:00:00.000Z",
    );
    db.close();

    db = openDatabase(path);
    migrate(db);
    service = new NotificationService(db);
    expect(
      service.list(member).items.find(({ id }) => id === notification.id)
        ?.readAt,
    ).toBe("2026-02-10T12:00:00.000Z");
    expect(service.generate(member).created).toBe(0);
    db.close();
  });

  it("enforces authenticated HTTP filtering and personal mutations", async () => {
    const db = database();
    insertAudit(db, "audit_http", "task.created", "task", "task_northstar_01", {
      assigneeMembershipId: "membership_member",
    });
    const app = createApp(db);
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const signIn = async (email: string, password: string) => {
      const response = await fetch(`${baseUrl}/api/auth/sign-in`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      return response.headers.get("set-cookie")!.split(";")[0];
    };
    const cookie = await signIn("member@northstar.test", "MemberPass!2026");
    expect((await fetch(`${baseUrl}/api/notifications`)).status).toBe(401);
    expect(
      (
        await fetch(`${baseUrl}/api/notifications?filter=invalid`, {
          headers: { cookie },
        })
      ).status,
    ).toBe(400);
    const response = await fetch(`${baseUrl}/api/notifications?filter=unread`, {
      headers: { cookie },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      items: unknown[];
      unreadCount: number;
    };
    expect(body.items.length).toBe(body.unreadCount);
    const marked = await fetch(`${baseUrl}/api/notifications/read-all`, {
      method: "POST",
      headers: { cookie },
    });
    expect(marked.status).toBe(200);
    expect(
      ((await marked.json()) as { updated: number }).updated,
    ).toBeGreaterThan(0);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    db.close();
  });
});
