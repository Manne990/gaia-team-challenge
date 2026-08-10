import { expect, test } from "./fixtures";
import { AxeBuilder } from "@axe-core/playwright";

const viewports = [
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
  { width: 390, height: 844 },
];

const authenticatedRoutes = [
  ["#dashboard", "Good morning, Northstar"],
  ["#companies", "Companies"],
  ["#contacts", "Contacts"],
  ["#activities", "Activities"],
  ["#deals", "Deals"],
  ["#tasks", "Tasks"],
  ["#notifications", "Notifications"],
  ["#imports", "Imports"],
  ["#duplicates", "Duplicate review"],
  ["#audit", "Audit history"],
  ["#administration", "Organization administration"],
] as const;

async function signIn(page: import("@playwright/test").Page) {
  await page.goto("/");
  if (await page.getByRole("heading", { name: "Welcome back" }).isVisible()) {
    await page.getByLabel("Email address").fill("owner@northstar.test");
    await page.getByLabel("Password").fill("OwnerPass!2026");
    await page.getByRole("button", { name: "Sign in" }).click();
  }
  await expect(
    page.getByRole("heading", { name: "Good morning, Northstar" }),
  ).toBeVisible();
}

async function expectNoHorizontalScroll(
  page: import("@playwright/test").Page,
  route: string,
) {
  const dimensions = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(
    dimensions.scrollWidth,
    `${route} overflows by ${dimensions.scrollWidth - dimensions.clientWidth}px`,
  ).toBeLessThanOrEqual(dimensions.clientWidth);
}

test.describe("browser accessibility and runtime health", () => {
  test("renders the anonymous sign-in state without console errors", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "Welcome back", exact: true }),
    ).toBeVisible();
    expect(errors).toEqual([]);
  });

  for (const viewport of viewports) {
    test(`has no page-level horizontal scrolling at ${viewport.width}x${viewport.height}`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await page.goto("/");
      await expect(
        page.getByRole("heading", { name: "Welcome back", exact: true }),
      ).toBeVisible();
      await expectNoHorizontalScroll(page, "sign-in");
      await signIn(page);
      for (const [route, heading] of authenticatedRoutes) {
        await page.goto(`/${route}`);
        await expect(
          page.getByRole("heading", { name: heading, exact: true }),
        ).toBeVisible();
        await page.waitForLoadState("networkidle");
        await expectNoHorizontalScroll(page, route);
      }
    });
  }

  test("supports skip-link keyboard navigation and named dialog focus", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(page);

    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("link", { name: "Skip to content" }),
    ).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("#main-content")).toBeFocused();

    await page.goto("/#activities");
    await expect(
      page.getByRole("heading", { name: "Activities" }),
    ).toBeVisible();
    const record = page.getByRole("button", { name: "Record activity" });
    await record.click();
    const dialog = page.getByRole("dialog", { name: "Record activity" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute(
      "aria-labelledby",
      "activity-form-title",
    );
    await expect(dialog.getByLabel("Type")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(record).toBeFocused();
  });

  for (const viewport of [
    { width: 834, height: 1112 },
    { width: 390, height: 844 },
  ]) {
    test(`has no full-page accessibility violations at ${viewport.width}x${viewport.height}`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await signIn(page);
      await page.goto("/#administration");
      await expect(
        page.getByRole("heading", { name: "Organization administration" }),
      ).toBeVisible();
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    });
  }
});
