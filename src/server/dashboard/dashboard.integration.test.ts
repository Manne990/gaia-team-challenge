// @vitest-environment node
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrate, openDatabase, type CrmDatabase } from "../../db/database.js";
import { seedDatabase } from "../../db/seed.js";
import { createApp } from "../app.js";
import type { SessionIdentity } from "../auth/index.js";
import { CompanyService } from "../companies/service.js";
import { DealsService } from "../deals/service.js";
import { TaskService } from "../tasks/service.js";
import { DashboardService } from "./service.js";

const anchor = new Date("2026-01-15T12:00:00.000Z");
const identity: SessionIdentity = {
  sessionHash: "test",
  userId: "user_owner",
  membershipId: "membership_owner",
  organizationId: "org_northstar",
  role: "owner",
  email: "owner@northstar.test",
  displayName: "Northstar Owner",
  expiresAt: "2027-01-01T00:00:00.000Z",
};

let database: CrmDatabase;
beforeEach(() => {
  database = openDatabase(":memory:");
  migrate(database);
  seedDatabase(database);
});
afterEach(() => database.close());

describe.sequential("dashboard evidence read model", () => {
  it("uses exact UTC boundaries, separates currencies, and reconciles linked lists", () => {
    database
      .prepare(
        `INSERT INTO deals (id,organization_id,company_id,owner_membership_id,stage_id,name,amount_minor,currency,expected_close_date,probability,status,loss_reason,created_at,updated_at)
         VALUES ('deal_boundary','org_northstar','company_northstar_01','membership_owner','stage_northstar_lead','Boundary SEK',5050,'SEK','2026-01-15',50,'open',NULL,?,?)`,
      )
      .run(anchor.toISOString(), anchor.toISOString());
    database
      .prepare("UPDATE tasks SET due_at=? WHERE id='task_northstar_01'")
      .run(anchor.toISOString());
    database
      .prepare(
        `INSERT INTO activities (id,organization_id,creator_membership_id,company_id,type,subject,body,occurred_at,created_at,updated_at,creator_label,company_label)
         VALUES ('activity_boundary','org_northstar','membership_owner','company_northstar_01','call','Boundary call','',?,?,?,?,?)`,
      )
      .run(
        anchor.toISOString(),
        anchor.toISOString(),
        anchor.toISOString(),
        "Northstar Owner",
        "Duplicate Trading Name",
      );

    const dashboard = new DashboardService(database, () => anchor).get(
      identity,
    );
    expect(
      dashboard.openPipeline.totals.map(({ currency }) => currency),
    ).toEqual(["SEK", "USD"]);
    expect(dashboard.tasks.upcoming).toBeGreaterThan(0);
    expect(dashboard.recentActivity.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "activity_boundary" }),
      ]),
    );

    const deals = new DealsService(database, () => anchor);
    const open = deals.list(identity, new URLSearchParams("status=open"));
    expect(open.total).toBe(dashboard.openPipeline.count);
    expect(open.totals.byCurrency).toEqual(dashboard.openPipeline.totals);
    const closing = deals.list(
      identity,
      new URLSearchParams({
        status: "open",
        closeFrom: dashboard.semantics.closeFrom,
        closeTo: dashboard.semantics.closeTo,
      }),
    );
    expect(closing.total).toBe(dashboard.closingSoon.count);
    expect(closing.totals.byCurrency).toEqual(dashboard.closingSoon.totals);
    for (const month of dashboard.outcomeTrend)
      for (const status of ["won", "lost"] as const)
        expect(
          deals.list(
            identity,
            new URLSearchParams({
              status,
              outcomeFrom: month.from,
              outcomeTo: month.to,
            }),
          ).total,
        ).toBe(month[status]);
    const tasks = new TaskService(database, () => anchor);
    expect(
      tasks.list(identity, new URLSearchParams("view=overdue")).total,
    ).toBe(dashboard.tasks.overdue);
    expect(
      tasks.list(
        identity,
        new URLSearchParams({
          view: "window",
          dueFrom: dashboard.asOf,
          dueTo: dashboard.semantics.upcomingTo,
        }),
      ).total,
    ).toBe(dashboard.tasks.upcoming);
    const companies = new CompanyService(database);
    expect(
      companies.list(
        identity,
        new URLSearchParams({
          staleBefore: dashboard.semantics.staleBefore,
          staleThrough: dashboard.asOf,
        }),
      ).total,
    ).toBe(dashboard.staleAccounts.count);
  });

  it("returns useful zeroes for an empty organization and never leaks another tenant", () => {
    const outside = {
      ...identity,
      organizationId: "org_outside",
      membershipId: "membership_outside",
    };
    const result = new DashboardService(database, () => anchor).get(outside);
    expect(result.openPipeline.count).toBe(0);
    expect(result.openPipeline.totals).toEqual([]);
    expect(result.recentActivity.items).toEqual([]);
    expect(JSON.stringify(result)).not.toContain("Northstar");
  });
});

describe.sequential("dashboard HTTP authorization", () => {
  it("allows every signed-in role and isolates organizations", async () => {
    const app = createApp(database);
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const signIn = async (email: string, password: string) => {
      const response = await fetch(`${base}/api/auth/sign-in`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      return response.headers.get("set-cookie")!.split(";")[0]!;
    };
    expect((await fetch(`${base}/api/dashboard`)).status).toBe(401);
    for (const [email, password] of [
      ["owner@northstar.test", "OwnerPass!2026"],
      ["member@northstar.test", "MemberPass!2026"],
      ["viewer@northstar.test", "ViewerPass!2026"],
    ]) {
      const cookie = await signIn(email!, password!);
      expect(
        (await fetch(`${base}/api/dashboard`, { headers: { cookie } })).status,
      ).toBe(200);
    }
    const outsideCookie = await signIn(
      "other-owner@outside.test",
      "OutsidePass!2026",
    );
    const outside = await fetch(`${base}/api/dashboard`, {
      headers: { cookie: outsideCookie },
    }).then((response) => response.text());
    expect(outside).not.toContain("Northstar");
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
});
