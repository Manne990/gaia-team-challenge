import { AxeBuilder } from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("browser harness serves an accessible critical-path document", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Northstar CRM" })).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});
