import { expect, test } from "./fixtures";

async function signIn(
  page: import("@playwright/test").Page,
  email: string,
  password: string,
) {
  await page.goto("/#contacts");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(
    page.getByRole("heading", { name: "Contacts", exact: true }),
  ).toBeVisible();
}

test.describe("contact management", () => {
  test("creates, reads, edits, archives, and restores a contact", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await signIn(page, "owner@northstar.test", "OwnerPass!2026");

    await page.getByRole("button", { name: "Create contact" }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toHaveAccessibleName("Create contact");
    await dialog.getByLabel("First name").fill("Browser");
    await dialog.getByLabel("Last name").fill("Evidence");
    await dialog
      .getByLabel("Email", { exact: true })
      .fill("Browser.Evidence@Example.test");
    await dialog.getByLabel("Phone", { exact: true }).fill("+46 70 123 45 67");
    await dialog.getByLabel("Job title").fill("Evidence Lead");
    await dialog.getByLabel("Tags (comma separated)").fill("browser, priority");
    await dialog.getByRole("button", { name: "Save contact" }).click();

    await expect(
      dialog.getByRole("heading", { name: "Browser Evidence" }),
    ).toBeVisible();
    await expect(dialog.getByText("Evidence Lead")).toBeVisible();
    await expect(
      dialog.getByRole("heading", { name: "Change history" }),
    ).toBeVisible();
    await expect(dialog.getByText("contact.created")).toBeVisible();

    await dialog.getByRole("button", { name: "Edit" }).click();
    await dialog.getByLabel("Job title").fill("Senior Evidence Lead");
    await dialog.getByRole("button", { name: "Save contact" }).click();
    await expect(dialog.getByText("Senior Evidence Lead")).toBeVisible();

    await dialog.getByRole("button", { name: "Archive contact" }).click();
    await expect(
      dialog.getByRole("button", { name: "Restore contact" }),
    ).toBeVisible();
    await dialog.getByRole("button", { name: "Close contact details" }).click();
    await expect(
      page.getByRole("button", { name: "Browser Evidence" }),
    ).toHaveCount(0);

    await page.getByLabel("Include archived").check();
    await page.getByRole("button", { name: "Browser Evidence" }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Restore contact" })
      .click();
    await expect(
      page.getByRole("dialog").getByRole("button", { name: "Archive contact" }),
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

  test("keeps viewer contact access read-only", async ({ page }) => {
    await signIn(page, "viewer@northstar.test", "ViewerPass!2026");
    await expect(
      page.getByRole("button", { name: "Create contact" }),
    ).toHaveCount(0);
    const firstContact = page.locator("tbody .contact-link").first();
    await firstContact.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("button", { name: "Edit" })).toHaveCount(0);
    await expect(
      dialog.getByRole("button", { name: "Archive contact" }),
    ).toHaveCount(0);
  });
});
