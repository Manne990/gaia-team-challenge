import { AxeBuilder } from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("member receives and reads a replay-safe assignment notification", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Email address").fill("member@northstar.test");
  await page.getByLabel("Password").fill("MemberPass!2026");
  await page.getByRole("button", { name: "Sign in" }).click();

  await page.getByRole("link", { name: "Tasks", exact: true }).click();
  await page.getByRole("button", { name: "Create task" }).click();
  const form = page.locator("form.task-form");
  await form.getByLabel("Title *").fill("Review notification evidence");
  await form.getByLabel("Assignee *").selectOption("membership_member");
  await form.getByLabel("Due time (UTC) *").fill("2026-12-18T10:00");
  await form.getByRole("button", { name: "Create task" }).click();

  await page.getByRole("link", { name: "Notifications", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Notifications" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Task assigned" }),
  ).toBeVisible();
  await expect(page.getByText("A task was assigned to you.")).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  await page.getByRole("button", { name: "Mark all as read" }).click();
  await page.getByRole("button", { name: "Unread" }).click();
  await expect(page.getByText("You’re all caught up")).toBeVisible();
  await page.getByRole("button", { name: "All", exact: true }).click();
  await page.getByRole("link", { name: "View related task" }).first().click();
  await expect(page.getByRole("heading", { name: "Tasks" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Task details" }),
  ).toBeVisible();
});
