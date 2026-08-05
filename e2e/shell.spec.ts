import { expect, test } from '@playwright/test';

async function signIn(
  page: import('@playwright/test').Page,
  email = 'owner@northstar.test',
  password = 'OwnerPass!2026',
) {
  await page.goto('/');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('navigation', { name: 'CRM navigation' })).toBeVisible();
}

test('navigates the operational shell at desktop size', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page);

  await expect(page.getByRole('navigation', { name: 'CRM navigation' })).toBeVisible();
  await page.getByRole('button', { name: 'Companies' }).click();
  await expect(page.getByRole('heading', { name: 'Companies', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Companies' })).toHaveAttribute(
    'aria-current',
    'page',
  );
});

test('opens navigation without page-level horizontal scrolling on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);

  await page.getByRole('button', { name: 'Menu' }).click();
  await expect(page.getByRole('navigation', { name: 'CRM navigation' })).toBeVisible();
  await expect(
    page.locator('html').evaluate((element) => element.scrollWidth <= window.innerWidth),
  ).resolves.toBe(true);
});

test('persists an owner-created task across an authenticated reload', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await signIn(page);
  await page.getByRole('button', { name: 'Tasks' }).click();
  await expect(page.getByText('Task workspace')).toBeVisible();
  const title = 'Persisted browser follow-up';
  await page.getByLabel('Task title').fill(title);
  await page.getByRole('button', { name: 'Add task' }).click();
  await expect(page.getByText(title)).toBeVisible();
  await page.reload();
  await expect(page.getByRole('navigation', { name: 'CRM navigation' })).toBeVisible();
  await page.getByRole('button', { name: 'Tasks' }).click();
  await expect(page.getByText(title)).toBeVisible();
});

test('renders viewer authorization from the authenticated session', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await signIn(page, 'viewer@northstar.test', 'ViewerPass!2026');
  await expect(page.getByText('viewer', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Administration' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /create/i })).toHaveCount(0);
});
