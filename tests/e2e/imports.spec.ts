import { AxeBuilder } from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

async function signIn(
  page: import("@playwright/test").Page,
  email: string,
  password: string,
) {
  await page.goto("/#imports");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Imports" })).toBeVisible();
}

test("member previews and explicitly commits a mapped CSV without responsive or accessibility regressions", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, "member@northstar.test", "MemberPass!2026");
  await page.getByLabel("CSV file").setInputFiles({
    name: "browser-companies.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "Company,Reference,Tags,Status\nBrowser CSV Company,BROWSER-CSV-130,priority;browser,prospect\n",
    ),
  });
  await page.getByLabel("Name (required)").selectOption("Company");
  await page.getByLabel("External reference").selectOption("Reference");
  await page.getByLabel("Tags").selectOption("Tags");
  await page.getByLabel("Lifecycle status").selectOption("Status");
  await page.getByRole("button", { name: "Request preview" }).click();
  await expect(
    page.getByRole("heading", { name: "browser-companies.csv" }),
  ).toBeVisible();
  await expect(page.getByText("BROWSER-CSV-130")).toBeVisible();
  await page.getByRole("button", { name: "Commit clean preview" }).click();
  await expect(page.getByText("Committed successfully")).toBeVisible();

  const imported = await page.evaluate(async () => {
    const response = await fetch("/api/companies?q=Browser%20CSV%20Company");
    const body = (await response.json()) as { total: number };
    return { status: response.status, total: body.total };
  });
  expect(imported).toEqual({ status: 200, total: 1 });
  expect(
    (await new AxeBuilder({ page }).include("#main-content").analyze())
      .violations,
  ).toEqual([]);
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
});

test("viewer can export but cannot access import mutation controls", async ({
  page,
}) => {
  await signIn(page, "viewer@northstar.test", "ViewerPass!2026");
  await expect(page.getByText(/Viewer access is read-only/)).toBeVisible();
  await expect(page.getByLabel("CSV file")).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Download CSV" }),
  ).toHaveAttribute("href", "/api/exports/companies.csv");
});
