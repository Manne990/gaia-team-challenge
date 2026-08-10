import { AxeBuilder } from "@axe-core/playwright";
import { expect, test } from "./fixtures";

test("owner administers access and reviews correlated audit history", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Email address").fill("owner@northstar.test");
  await page.getByLabel("Password").fill("OwnerPass!2026");
  await page.getByRole("button", { name: "Sign in" }).click();

  await page.getByRole("link", { name: "Administration", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Organization administration" }),
  ).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  await page.getByLabel("Name", { exact: true }).fill("Northstar Revenue");
  await page.getByRole("button", { name: "Save name" }).click();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
    "Northstar Revenue",
  );

  await page
    .getByLabel("Email", { exact: true })
    .fill("browser.admin@northstar.test");
  await page.getByLabel("Display name").fill("Browser Member");
  await page.getByLabel("Temporary password").fill("BrowserPass!2026");
  await page.getByRole("button", { name: "Add member" }).click();
  await expect(
    page.getByRole("cell", { name: "Browser Member", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Role for Browser Member").selectOption("viewer");
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("row", { name: /Browser Member/ })
    .getByRole("button", { name: "Revoke access" })
    .click();
  await expect(
    page.getByRole("cell", { name: "Browser Member", exact: true }),
  ).not.toBeVisible();

  await page.getByRole("link", { name: "Audit", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Audit history" }),
  ).toBeVisible();
  await page.getByLabel("Action").fill("membership.removed");
  const filtered = page.waitForResponse((response) =>
    response.url().includes("action=membership.removed"),
  );
  await page.getByRole("button", { name: "Apply filters" }).click();
  await filtered;
  const event = page
    .getByRole("listitem")
    .filter({ hasText: "membership.removed" });
  await expect(event).toHaveCount(1);
  await expect(event.getByText(/Correlation ID:/)).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
