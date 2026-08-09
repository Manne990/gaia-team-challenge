import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { startBrowserFixtureServer } from "../support/browser-server.mjs";

test("owner can sign in, reach CRM records, and use the primary workflow accessibly", async ({ page }) => {
  const server = await startBrowserFixtureServer();
  try {
    await page.goto(server.url);
    await page.getByLabel("Email").fill("owner@northstar.test");
    await page.getByLabel("Password").fill("OwnerPass!2026");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    await expect(page.getByText("27 accounts")).toBeVisible();
    await page.getByRole("link", { name: "Companies" }).click();
    await expect(page.getByRole("heading", { name: "Companies" })).toBeVisible();
    await expect(page.getByRole("table", { name: "Company records" })).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  } finally {
    await server.stop();
  }
});

test("a signed-in user cannot discover or mutate a foreign company", async ({ page }) => {
  const server = await startBrowserFixtureServer();
  try {
    await page.goto(server.url);
    await page.getByLabel("Email").fill("owner@northstar.test");
    await page.getByLabel("Password").fill("OwnerPass!2026");
    await page.getByRole("button", { name: "Sign in" }).click();
    const before = server.company("cmp_outside_acme");
    const read = await page.request.get(`${server.url}/api/companies/cmp_outside_acme`);
    const mutation = await page.request.put(`${server.url}/api/companies/cmp_outside_acme`, { data: { name: "Mutated" } });
    expect(read.status()).toBe(404);
    expect(mutation.status()).toBe(404);
    expect(server.company("cmp_outside_acme")).toEqual(before);
  } finally {
    await server.stop();
  }
});
