import { AxeBuilder } from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

async function signIn(
  page: import("@playwright/test").Page,
  email: string,
  password: string,
) {
  await page.goto("/");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(
    page.getByRole("complementary", { name: "Primary" }),
  ).toBeVisible();
}

test("member manages a durable company while viewer and tenant boundaries remain read-only", async ({
  page,
}) => {
  await signIn(page, "member@northstar.test", "MemberPass!2026");
  await page.getByRole("link", { name: "Companies" }).click();
  await expect(
    page.getByRole("heading", { name: "All companies" }),
  ).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  const foreignRead = await page.evaluate(async () => {
    const response = await fetch("/api/companies/company_outside_01");
    return { status: response.status, body: await response.json() };
  });
  expect(foreignRead).toEqual({
    status: 404,
    body: { code: "NOT_FOUND", error: "Company not found." },
  });

  await page.getByRole("button", { name: "Create company" }).click();
  await page.getByLabel("Name").fill("Browser Evidence Company");
  await page.getByLabel("External reference").fill("browser-123");
  await page.getByLabel("Website").fill("https://browser-evidence.example");
  await page.getByLabel("Phone").fill("+46 8 555 0123");
  await page.getByLabel("Industry").fill("Technology");
  await page.getByLabel("Size").fill("11-50");
  await page.getByLabel("Address").fill("123 Evidence Street");
  await page.getByLabel("Owner").selectOption({ label: "Northstar Member" });
  await page.getByLabel("Lifecycle").selectOption("customer");
  await page.getByLabel("Tags").fill("priority, browser");
  await page
    .getByLabel("Description")
    .fill("Created through the real browser-backed company workflow.");
  await page.getByRole("button", { name: "Save company" }).click();

  await expect(
    page.getByRole("heading", { name: "Browser Evidence Company" }),
  ).toBeVisible();
  await expect(page.getByText("BROWSER-123")).toBeVisible();
  await expect(page.getByText("company.created")).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  await page.getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("Name").fill("Browser Evidence Company Updated");
  await page.getByRole("button", { name: "Save company" }).click();
  await expect(
    page.getByRole("heading", { name: "Browser Evidence Company Updated" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Archive" }).click();
  await expect(page.getByRole("alertdialog")).toContainText(
    "hidden from the default list",
  );
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "archive" })
    .click();
  await expect(page.getByRole("button", { name: "Restore" })).toBeVisible();

  await page.getByRole("button", { name: "Sign out" }).click();
  await signIn(page, "viewer@northstar.test", "ViewerPass!2026");
  await page.getByRole("link", { name: "Companies" }).click();
  await expect(
    page.getByRole("heading", { name: "All companies" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Create company" }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Duplicate Trading Name", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: "Company information" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Archive" })).toHaveCount(0);
});
