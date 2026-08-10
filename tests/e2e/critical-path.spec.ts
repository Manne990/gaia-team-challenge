import { AxeBuilder } from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("owner signs in, sees tenant-scoped records, and crosses an accessible critical path", async ({ page, request }) => {
  await page.goto("/");
  await page.getByLabel("Email").fill("owner@northstar.test");
  await page.getByLabel("Password").fill("OwnerPass!2026");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await page.getByRole("link", { name: "Companies" }).click();
  await expect(page.getByRole("heading", { name: "Companies" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Acme Group", exact: true })).toHaveCount(2);
  await expect(page.getByRole("row")).toHaveCount(37);
  const cookies = await page.context().cookies();
  const cookie = cookies.map(({ name, value }) => `${name}=${value}`).join("; ");
  expect((await request.get("/api/companies/company_37", { headers: { cookie } })).status()).toBe(404);
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});
