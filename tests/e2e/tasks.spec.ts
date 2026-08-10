import { AxeBuilder } from "@axe-core/playwright";
import { expect, test } from "./fixtures";

test("member creates and completes a durable UTC task", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Email address").fill("member@northstar.test");
  await page.getByLabel("Password").fill("MemberPass!2026");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(
    page.getByRole("heading", { name: "Good morning, Northstar" }),
  ).toBeVisible();

  await page.getByRole("link", { name: "Tasks", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Tasks" })).toBeVisible();
  await expect(page.getByText("Due times shown in UTC")).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  await page.getByRole("button", { name: "Create task" }).click();
  const form = page.locator("form.task-form");
  await form.getByLabel("Title *").fill("Confirm browser renewal");
  await form
    .getByLabel("Description")
    .fill("Created through the real task workflow.");
  await form.getByLabel("Assignee *").selectOption("membership_member");
  await form.getByLabel("Due time (UTC) *").fill("2026-12-15T10:30");
  await form.getByLabel("Priority").selectOption("urgent");
  await form.getByRole("button", { name: "Create task" }).click();

  await expect(
    page.getByRole("heading", { name: "Task details" }),
  ).toBeVisible();
  await expect(
    page.getByText("Created through the real task workflow."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Complete" }).click();
  await expect(page.getByRole("button", { name: "Reopen" })).toBeVisible();
  await page.getByLabel("Task view").selectOption("completed");
  await expect(
    page.getByRole("button", { name: "Confirm browser renewal" }),
  ).toBeVisible();
});
