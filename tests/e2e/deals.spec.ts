import { expect, test } from "@playwright/test";

async function signIn(
  page: import("@playwright/test").Page,
  email: string,
  password: string,
) {
  await page.goto("/#deals");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(
    page.getByRole("heading", { name: "Deals", exact: true }),
  ).toBeVisible();
}

test.describe("deal pipeline", () => {
  test("creates, transitions, reopens, archives and restores a deal without drag", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await signIn(page, "owner@northstar.test", "OwnerPass!2026");
    await page.getByRole("button", { name: "Create deal" }).first().click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Name").fill("Browser Pipeline Evidence");
    await dialog.getByLabel("Company ID").fill("company_northstar_01");
    await dialog.getByLabel("Owner membership ID").fill("membership_owner");
    await dialog.getByLabel("Amount (minor units)").fill("987654");
    await dialog.getByLabel("Currency").fill("SEK");
    await dialog.getByLabel("Probability (%)").fill("40");
    await dialog.getByLabel("Expected close date").fill("2026-11-20");
    await dialog
      .getByLabel("Contact IDs (comma separated)")
      .fill("contact_northstar_01");
    await dialog.getByRole("button", { name: "Save deal" }).click();
    await expect(
      dialog.getByRole("heading", { name: "Browser Pipeline Evidence" }),
    ).toBeVisible();
    await dialog.getByLabel("New stage").selectOption({ label: "Lost" });
    await dialog.getByLabel("Loss reason").fill("Procurement paused");
    await dialog.getByRole("button", { name: "Transition" }).click();
    await expect(dialog.getByText("lost", { exact: true })).toBeVisible();
    await dialog.getByLabel("New stage").selectOption({ label: "Qualified" });
    await dialog.getByRole("button", { name: "Transition" }).click();
    await expect(dialog.getByText("open", { exact: true })).toBeVisible();
    await expect(dialog.getByText("Lost → Qualified")).toBeVisible();
    await dialog.getByRole("button", { name: "Archive" }).click();
    await expect(dialog.getByRole("button", { name: "Restore" })).toBeVisible();
    await dialog.getByRole("button", { name: "Restore" }).click();
    await dialog.getByRole("button", { name: "Close deal details" }).click();
    await page.getByRole("button", { name: "Pipeline", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Change stage" }).first(),
    ).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            document.documentElement.scrollWidth <=
            document.documentElement.clientWidth,
        ),
      )
      .toBe(true);
  });
  test("keeps viewer pipeline access read-only", async ({ page }) => {
    await signIn(page, "viewer@northstar.test", "ViewerPass!2026");
    await expect(page.getByRole("button", { name: "Create deal" })).toHaveCount(
      0,
    );
    await page.getByRole("button", { name: "Pipeline", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Change stage" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Stage configuration" }),
    ).toHaveCount(0);
  });
});
