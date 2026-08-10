import { expect, test } from "./fixtures";

test("activity composer is modal, keyboard-safe, and records shared history", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#activities");
  await page.getByLabel("Email address").fill("member@northstar.test");
  await page.getByLabel("Password").fill("MemberPass!2026");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Activities" })).toBeVisible();

  const record = page.getByRole("button", { name: "Record activity" });
  await record.click();
  const dialog = page.getByRole("dialog", { name: "Record activity" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Type")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(record).toBeFocused();

  await record.click();
  const composer = page.getByRole("dialog", { name: "Record activity" });
  await composer.getByLabel("Subject").fill("Browser timeline evidence");
  await composer
    .getByLabel("Summary")
    .fill("Recorded through the shared timeline");
  await composer.getByRole("button", { name: "Save activity" }).click();
  await expect(composer).toHaveCount(0);
  await expect(page.getByText("Browser timeline evidence")).toBeVisible();
  await page.getByText("Browser timeline evidence").click();
  await page.getByRole("button", { name: "Edit activity" }).click();
  const editor = page.getByRole("dialog", { name: "Edit activity" });
  await editor.getByLabel("Subject").fill("Edited browser timeline evidence");
  await editor.getByRole("button", { name: "Save changes" }).click();
  await expect(
    page.getByRole("heading", { name: "Edited browser timeline evidence" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Delete activity" }),
  ).toBeVisible();
  page.once("dialog", (confirmation) => confirmation.accept());
  await page.getByRole("button", { name: "Delete activity" }).click();
  await expect(page.getByText("Edited browser timeline evidence")).toHaveCount(
    0,
  );
});
