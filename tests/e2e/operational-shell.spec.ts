import { expect, test } from "./fixtures";

const ownerNavigation = [
  "Dashboard",
  "Companies",
  "Contacts",
  "Activities",
  "Deals",
  "Tasks",
  "Notifications",
  "Imports",
  "Duplicates",
  "Audit",
  "Administration",
];

async function expectOwnerShell(
  page: import("@playwright/test").Page,
  checkOverflow = true,
) {
  await page.goto("/");
  await expect(
    page.getByRole("heading", {
      name: /Welcome back|Good morning, Northstar/,
    }),
  ).toBeVisible();
  if (await page.getByRole("heading", { name: "Welcome back" }).isVisible()) {
    await page.getByLabel("Email address").fill("owner@northstar.test");
    await page.getByLabel("Password").fill("OwnerPass!2026");
    await page.getByRole("button", { name: "Sign in" }).click();
  }
  await expect(
    page.getByRole("heading", { name: "Good morning, Northstar" }),
  ).toBeVisible();

  const navigation = page.getByRole("complementary", { name: "Primary" });
  const links = navigation.getByRole("link");
  await expect(links).toHaveCount(ownerNavigation.length);
  for (const [index, item] of ownerNavigation.entries()) {
    await expect(links.nth(index)).toHaveAttribute(
      "href",
      `#${item.toLowerCase()}`,
    );
  }

  if (checkOverflow) {
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            document.documentElement.scrollWidth <=
            document.documentElement.clientWidth,
        ),
      )
      .toBe(true);
  }
}

test.describe("operational CRM shell", () => {
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1024, height: 768 },
  ]) {
    test(`renders the owner shell without page overflow at ${viewport.width}x${viewport.height}`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await expectOwnerShell(page);
    });
  }

  test("opens and closes mobile navigation with focus restored", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await expectOwnerShell(page);

    const menuButton = page.getByRole("button", { name: "Open navigation" });
    const navigation = page.getByRole("complementary", { name: "Primary" });
    await expect(menuButton).toHaveAttribute("aria-expanded", "false");

    await menuButton.click();
    await expect(menuButton).toHaveAttribute("aria-expanded", "true");
    for (const item of ownerNavigation) {
      await expect(
        navigation.getByRole("link", { name: item, exact: true }),
      ).toBeVisible();
    }
    await expect(
      navigation.getByRole("link", { name: "Dashboard", exact: true }),
    ).toBeFocused();

    await navigation.getByRole("button", { name: "Close navigation" }).click();
    await expect(menuButton).toHaveAttribute("aria-expanded", "false");
    await expect(menuButton).toBeFocused();

    await menuButton.click();
    await navigation.getByRole("button", { name: "Close navigation" }).click();
    await expect(menuButton).toBeFocused();
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

  test("closes a product dialog from the keyboard", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await expectOwnerShell(page, false);

    await page.getByRole("button", { name: "Open navigation" }).click();
    await page
      .getByRole("complementary", { name: "Primary" })
      .getByRole("link", { name: "Activities", exact: true })
      .click();
    const recordActivity = page.getByRole("button", {
      name: "Record activity",
    });
    await recordActivity.click();

    const dialog = page.getByRole("dialog", { name: "Record activity" });
    await expect(dialog).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });

  test("announces saved-view feedback", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await expectOwnerShell(page, false);
    await page.getByRole("button", { name: "Open navigation" }).click();
    await page
      .getByRole("complementary", { name: "Primary" })
      .getByRole("link", { name: "Deals", exact: true })
      .click();
    await page.getByLabel("Save current view").fill("Mobile pipeline");
    await page.getByRole("button", { name: "Save view" }).click();

    const toast = page.getByRole("status");
    await expect(toast).toContainText("View saved.");
  });
});
