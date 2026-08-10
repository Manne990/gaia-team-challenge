import { AxeBuilder } from "@axe-core/playwright";
import { expect, test } from "./fixtures";

async function signIn(
  page: import("@playwright/test").Page,
  role: "member" | "viewer" = "member",
) {
  await page.goto("/");
  await page.getByLabel("Email address").fill(`${role}@northstar.test`);
  await page
    .getByLabel("Password")
    .fill(role === "member" ? "MemberPass!2026" : "ViewerPass!2026");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(
    page.getByRole("heading", { name: /Good morning/ }),
  ).toBeVisible();
}

test("dashboard metrics reconcile with their filtered records and refresh once", async ({
  page,
}) => {
  await signIn(page);
  const snapshot = await page.evaluate(async () => {
    const response = await fetch("/api/dashboard");
    return (await response.json()) as {
      openPipeline: { count: number };
    };
  });
  const openPipeline = page.getByRole("link", { name: /Open pipeline/ });
  await expect(openPipeline).toContainText(String(snapshot.openPipeline.count));
  await openPipeline.click();
  await expect(page).toHaveURL(/#deals\?status=open/);
  await expect(
    page.getByText(`${snapshot.openPipeline.count} deals`, { exact: true }),
  ).toBeVisible();

  await page.getByRole("link", { name: "Dashboard" }).click();
  await expect(page.getByRole("button", { name: "Refresh" })).toBeEnabled();
  const activitiesLink = page.getByRole("link", { name: "View activities" });
  const expectedActivityWindow = await activitiesLink.getAttribute("href");
  await activitiesLink.click();
  await expect(page.getByRole("heading", { name: "Activities" })).toBeVisible();
  const activityWindow = await page.evaluate(() => {
    const query = new URLSearchParams(location.hash.split("?")[1]);
    return { from: query.get("from"), to: query.get("to") };
  });
  const expectedQuery = new URLSearchParams(
    expectedActivityWindow?.split("?")[1],
  );
  expect(activityWindow).toEqual({
    from: expectedQuery.get("from"),
    to: expectedQuery.get("to"),
  });
  await page.getByRole("link", { name: "Dashboard", exact: true }).click();
  await expect(page.getByRole("button", { name: "Refresh" })).toBeEnabled();
  const dashboardRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/api/dashboard"))
      dashboardRequests.push(request.url());
  });
  await page.getByRole("button", { name: "Refresh" }).click();
  await expect(page.getByRole("button", { name: "Refresh" })).toBeEnabled();
  expect(dashboardRequests).toHaveLength(1);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("viewer receives the same read-only organization dashboard", async ({
  page,
}) => {
  await signIn(page, "viewer");
  await expect(
    page.getByRole("region", { name: "Sales overview" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Refresh" })).toBeVisible();
});
