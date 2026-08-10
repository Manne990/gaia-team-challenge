import { expect, test } from "@playwright/test";

const ownerNavigation = [
  "Dashboard",
  "Companies",
  "Contacts",
  "Activities",
  "Deals",
  "Tasks",
  "Imports",
  "Audit",
  "Administration",
];

async function expectOwnerShell(
  page: import("@playwright/test").Page,
  checkOverflow = true,
) {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Good morning, Alex" }),
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

  test("closes the confirmation dialog from the keyboard", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await expectOwnerShell(page, false);

    const createDeal = page.getByRole("button", {
      name: "Create deal",
      exact: true,
    });
    await createDeal.click();

    const dialog = page.getByRole("dialog", { name: "Create a new deal?" });
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "Create deal", exact: true }),
    ).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(createDeal).toBeFocused();
  });
});
