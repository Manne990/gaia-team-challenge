import { expect, test } from "@playwright/test";

async function signIn(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByLabel("Email address").fill("member@northstar.test");
  await page.getByLabel("Password").fill("MemberPass!2026");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(
    page.getByRole("complementary", { name: "Primary" }),
  ).toBeVisible();
}

test("global search and personal shareable saved views work end to end", async ({
  page,
}) => {
  await signIn(page);

  const search = page.getByRole("combobox", { name: "Search your workspace" });
  await search.fill("Company");
  await expect(page.getByRole("heading", { name: "Companies" })).toBeVisible();
  await search.press("ArrowDown");
  await expect(search).toHaveAttribute(
    "aria-activedescendant",
    "search-result-0",
  );
  await search.press("Escape");
  await expect(
    page.getByRole("listbox", { name: "Search results" }),
  ).toHaveCount(0);

  await page.getByRole("link", { name: "Companies" }).click();
  await search.fill("Northstar Company 3");
  await page
    .getByRole("listbox", { name: "Search results" })
    .getByRole("option")
    .first()
    .click();
  await expect(
    page.getByRole("searchbox", { name: "Search companies" }),
  ).toHaveValue(/Northstar Company/);
  await expect(page).toHaveURL(/#companies\?q=Northstar/);

  const lifecycle = page
    .locator('[aria-label="Company filters"] select')
    .first();
  await lifecycle.selectOption("customer");
  await expect(page).toHaveURL(/[?&]lifecycle=customer/);
  await page.getByLabel("Save current view").fill("Customer accounts");
  await page.getByRole("button", { name: "Save view" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "View saved." }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Clear filters" }).first().click();
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(lifecycle).toHaveValue("customer");
  await page.getByRole("button", { name: "Delete" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "View deleted." }),
  ).toBeVisible();
});
