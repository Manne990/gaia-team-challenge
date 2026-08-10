import { describe, expect, it } from "vitest";
import { crmFixture } from "../fixtures/crm.js";

describe("deterministic CRM fixture", () => {
  it("covers isolation, permissions, duplicate labels, history, stages, due states, and pagination", () => {
    expect(crmFixture.organizations).toHaveLength(2);
    expect(new Set(crmFixture.users.map(({ role }) => role))).toEqual(new Set(["owner", "member", "viewer"]));
    expect(crmFixture.companies.filter(({ name }) => name === "Acme Group")).toHaveLength(3);
    expect(crmFixture.activities.some(({ occurredAt }) => occurredAt < "2026-01-01")).toBe(true);
    expect(crmFixture.pipelineStages).toHaveLength(3);
    expect(crmFixture.tasks.map(({ id }) => id)).toEqual(["task_overdue", "task_upcoming", "task_completed"]);
    expect(crmFixture.companies.filter(({ organizationId }) => organizationId === "org_northstar_demo").length).toBeGreaterThan(25);
  });

  it("is anchored to fixed UTC values", () => {
    expect(crmFixture.anchorTime).toBe("2026-01-15T12:00:00.000Z");
  });
});
