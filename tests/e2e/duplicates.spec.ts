import { expect, test } from "@playwright/test";
test("reviewer explicitly resolves and confirms an explainable company merge", async ({
  page,
}) => {
  await page.goto("/#duplicates");
  await page.getByLabel("Email address").fill("member@northstar.test");
  await page.getByLabel("Password").fill("MemberPass!2026");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(
    page.getByRole("heading", { name: "Duplicate review" }),
  ).toBeVisible();
  const suggestion = page
    .getByRole("listitem")
    .filter({ hasText: "Duplicate Trading Name" })
    .first();
  await expect(suggestion).toContainText("name: duplicatetradingname");
  await suggestion.getByRole("button", { name: "Review merge" }).click();
  const dialog = page.getByRole("dialog", {
    name: "Choose survivor and field outcomes",
  });
  await expect(dialog.getByRole("radio").first()).toBeFocused();
  await expect(
    dialog.getByRole("button", { name: "Review consequences" }),
  ).toBeDisabled();
  await dialog.getByRole("radio").first().check();
  for (const select of await dialog
    .locator("tbody select:not(:disabled)")
    .all())
    await select.selectOption("left");
  await dialog.getByLabel("Resolve Industry").selectOption("right");
  await dialog.getByRole("button", { name: "Review consequences" }).click();
  await expect(dialog.getByText("Confirm irreversible merge")).toBeVisible();
  await dialog.getByRole("button", { name: "Confirm merge" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("listitem").filter({ hasText: "Duplicate Trading Name" }),
  ).toHaveCount(0);
});
